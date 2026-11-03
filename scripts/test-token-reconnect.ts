import assert from 'assert';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

const BASE_URL = process.env.API_BASE || 'http://localhost:4000';
const WS_URL = (process.env.WS_BASE || 'ws://localhost:4000/ws');
const DB_PATH = path.join(process.cwd(), 'data', 'app.db');

let serverProc: ChildProcess | null = null;

async function ensureServerRunning(base: string): Promise<void> {
  try {
    const res = await fetch(`${base}/api/business`);
    if (res.ok) return;
  } catch {}

  const url = new URL(base);
  const port = url.port || '4000';

  return new Promise((resolve, reject) => {
    serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: port,
        NODE_ENV: 'test',
        ADMIN_TOKEN: 'test-admin-token',
        MAX_CALLS_PER_DAY: '500',
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    serverProc.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes(`listening on http://localhost:${port}`)) {
        resolve();
      }
    });

    serverProc.on('error', reject);
    setTimeout(() => reject(new Error('Server start timed out after 12s')), 12000);
  });
}

async function stopServer() {
  if (serverProc) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(serverProc.pid), '/f', '/t']);
    } else {
      serverProc.kill('SIGTERM');
    }
    serverProc = null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function main() {
  await ensureServerRunning(BASE_URL);
  try {
    console.log('--- Running Token Lifecycle & Mid-Call Reconnect Test ---');

  // 1. Simulate missed call
  const sim = await json(`${BASE_URL}/api/missed-calls/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+1 (555) 018-4455', source: 'test' }),
  });
  assert.strictEqual(sim.status, 200, `Simulate failed: ${sim.status}`);
  const { token } = sim.data;
  assert(typeof token === 'string' && /^[a-f0-9]{32}$/i.test(token), 'Expected 32-hex token');
  console.log('✓ Simulated call created with secure token:', token.slice(0, 8) + '...');

  // 2. Pre-call validation returns valid: true, isReconnect: false
  const preCheck = await json(`${BASE_URL}/api/call-token/${token}`);
  assert.strictEqual(preCheck.status, 200);
  assert.strictEqual(preCheck.data.valid, true);
  assert.strictEqual(preCheck.data.isReconnect, false);
  console.log('✓ Pre-call validation: valid=true, isReconnect=false');

  // 3. Connect client 1 and join
  const ws1 = new WebSocket(WS_URL);
  await new Promise<void>((resolve, reject) => {
    ws1.on('open', () => {
      ws1.send(JSON.stringify({ type: 'join', token }));
    });
    ws1.on('message', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'state' && msg.state === 'GREETING') {
          resolve();
        }
      } catch {}
    });
    ws1.on('error', reject);
    setTimeout(() => reject(new Error('WS1 greeting timeout')), 10000);
  });
  console.log('✓ Client 1 joined, call started (state: GREETING)');

  // Verify call_started_at is stamped in DB
  const db = new Database(DB_PATH);
  const rowBefore = db.prepare('SELECT call_started_at FROM missed_calls WHERE token = ?').get(token) as { call_started_at?: string };
  assert(rowBefore?.call_started_at, 'call_started_at must be populated after call start');
  console.log('✓ call_started_at stamped in SQLite');

  // 4. Simulate page refresh: close WS1
  ws1.close();
  await new Promise((r) => setTimeout(r, 500)); // wait for socket close event

  // 5. While in disconnect grace period (within 12s), validation returns valid=true, isReconnect=true
  const reloadCheck = await json(`${BASE_URL}/api/call-token/${token}`);
  assert.strictEqual(reloadCheck.status, 200, `Expected 200 on reload during grace period, got ${reloadCheck.status}`);
  assert.strictEqual(reloadCheck.data.valid, true);
  assert.strictEqual(reloadCheck.data.isReconnect, true);
  console.log('✓ Mid-call reload check: valid=true, isReconnect=true');

  // 6. Connect client 2 (the reloaded page) with the same token
  const ws2 = new WebSocket(WS_URL);
  let reconnectedState = '';
  await new Promise<void>((resolve, reject) => {
    ws2.on('open', () => {
      ws2.send(JSON.stringify({ type: 'join', token }));
    });
    ws2.on('message', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'state') {
          reconnectedState = msg.state;
          resolve();
        }
      } catch {}
    });
    ws2.on('error', reject);
    setTimeout(() => reject(new Error('WS2 reconnect timeout')), 10000);
  });
  console.log('✓ Client 2 reconnected successfully! State:', reconnectedState);

  // Cleanly end the call via client 2
  ws2.send(JSON.stringify({ type: 'end', reason: 'user_hung_up' }));
  await new Promise<void>((resolve) => {
    ws2.on('message', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'summary' || msg.state === 'DONE') {
          resolve();
        }
      } catch {}
    });
    setTimeout(resolve, 3000);
  });
  ws2.close();
  await new Promise((r) => setTimeout(r, 1000));
  console.log('✓ Call ended cleanly');

  // 7. Post-call validation: token cannot be reused once call has finished
  const postCheck = await json(`${BASE_URL}/api/call-token/${token}`);
  assert.strictEqual(postCheck.status, 409, `Expected 409 Conflict after call concluded, got ${postCheck.status}`);
  assert.strictEqual(postCheck.data.code, 'call_concluded');
  console.log('✓ Single-use guarantee preserved: post-call validation returned 409 (call_concluded)');

  // 8. Replay attack on WebSocket with concluded token
  const wsReplay = new WebSocket(WS_URL);
  let replayError = '';
  await new Promise<void>((resolve) => {
    wsReplay.on('open', () => {
      wsReplay.send(JSON.stringify({ type: 'join', token }));
    });
    wsReplay.on('message', (d) => {
      try {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'error') {
          replayError = msg.message;
          resolve();
        }
      } catch {}
    });
    setTimeout(resolve, 4000);
  });
  wsReplay.close();
  assert(replayError.includes('already been used'), `Expected replay rejection, got: ${replayError}`);
  console.log('✓ WebSocket replay attempt rejected:', replayError);

    console.log('\n🎉 ALL TOKEN LIFECYCLE & RECONNECT TESTS PASSED!');
  } finally {
    await stopServer();
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
