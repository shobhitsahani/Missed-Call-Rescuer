import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import Database from 'better-sqlite3';

const TEST_PORT = 4098;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEMP_DB = path.join(__dirname, '../data/test-security.db');

function removeTestDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${TEMP_DB}${suffix}`;
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
}

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wsJoinError(token: string): Promise<string | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, {
      headers: { Origin: 'https://missed-call-rescuer.vercel.app' },
    });
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(null);
    }, 5000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', token }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'error') {
          clearTimeout(timer);
          ws.close();
          resolve(String(msg.message || ''));
        }
      } catch {}
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function captureMissedCallEvent(trigger: () => Promise<void>): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`${BASE_URL}/api/events`, {
    headers: { Origin: 'https://missed-call-rescuer.vercel.app' },
    signal: controller.signal,
  });
  if (!res.ok || !res.body) throw new Error(`SSE subscribe failed with ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    await trigger();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const start = buffer.indexOf('event: missed_call');
      if (start >= 0) {
        const end = buffer.indexOf('\n\n', start);
        if (end >= 0) return buffer.slice(start, end);
      }
    }
  } catch {
    // Abort/deadline: return whatever was received.
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return buffer;
}

async function waitForServer(maxWaitMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // waiting
    }
    await sleep(250);
  }
  throw new Error(`Server failed to start on port ${TEST_PORT} within ${maxWaitMs}ms`);
}

async function runSecuritySuite() {
  console.log('====================================================');
  console.log('🧪 Missed-Call Rescuer Security & Hardening Test Suite');
  console.log('====================================================');

  // Clean prior test DB
  removeTestDb();

  // Verify server starts cleanly WITHOUT ACCESS_CODE or SESSION_SECRET
  const testEnv: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(TEST_PORT),
    DB_PATH: TEMP_DB,
    ALLOWED_ORIGINS: 'http://localhost:3010,https://missed-call-rescuer.vercel.app',
    MAX_CONCURRENT_CALLS: '2',
    MAX_CALLS_PER_DAY: '5',
    ADMIN_TOKEN: 'test-admin-token',
    NODE_ENV: 'production',
  };
  delete testEnv.ACCESS_CODE;
  delete testEnv.SESSION_SECRET;

  const child: ChildProcess = spawn(
    'npx',
    ['tsx', 'server/index.ts'],
    {
      cwd: path.join(__dirname, '..'),
      env: testEnv as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    }
  );

  let serverOutput = '';
  child.stdout?.on('data', (d) => {
    serverOutput += d.toString();
  });
  child.stderr?.on('data', (d) => {
    serverOutput += d.toString();
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      if (process.platform === 'win32' && child.pid) {
        try {
          execSync(`taskkill /pid ${child.pid} /f /t`, { stdio: 'ignore' });
        } catch {}
      } else {
        child.kill('SIGTERM');
      }
    } catch {}
    removeTestDb();
  };

  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  try {
    console.log(`[Setup] Waiting for server on ${BASE_URL} (NODE_ENV=production, NO ACCESS_CODE)...`);
    await waitForServer();
    console.log('✓ Test server started cleanly in production mode without ACCESS_CODE.\n');

    // TEST 1: Open access for hackathon judges - /api/business requires no password
    console.log('[Test 1] Open access: dashboard /api/business accessible without auth token');
    const bizRes = await fetch(`${BASE_URL}/api/business`);
    assert(bizRes.status === 200, `Expected status 200, got ${bizRes.status}`);
    const bizData = await bizRes.json();
    assert(typeof bizData.name === 'string', 'Business name should be returned');
    console.log(`✓ PASS: Dashboard accessed with 200 OK (Business: "${bizData.name}").`);

    // TEST 2: CORS allows deployed frontend domain
    console.log('\n[Test 2] CORS: deployed frontend origin (https://missed-call-rescuer.vercel.app) allowed');
    const corsResValid = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'https://missed-call-rescuer.vercel.app' },
    });
    const allowOrigin = corsResValid.headers.get('access-control-allow-origin');
    assert(
      allowOrigin === 'https://missed-call-rescuer.vercel.app',
      `Expected CORS allow origin https://missed-call-rescuer.vercel.app, got ${allowOrigin}`
    );
    console.log('✓ PASS: Deployed frontend origin explicitly allowed by CORS policy.');

    // TEST 3: Foreign Origin rejected on CORS
    console.log('\n[Test 3] CORS: foreign origin rejected');
    const corsRes = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'http://malicious-external-site.com' },
    });
    const rejectedOrigin = corsRes.headers.get('access-control-allow-origin');
    assert(rejectedOrigin !== 'http://malicious-external-site.com', 'Foreign origin must not be allowed in CORS headers');
    assert(corsRes.status === 403, `Expected 403 for foreign Origin, got ${corsRes.status}`);
    console.log('✓ PASS: Malicious foreign Origin rejected with 403 and no CORS allow header.');

    // TEST 4: Foreign Origin rejected on WebSocket upgrade
    console.log('\n[Test 4] WebSocket Origin check: foreign origin rejected on upgrade');
    const wsRejected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, {
        headers: { Origin: 'http://unauthorized-origin.com' },
      });
      ws.on('open', () => {
        ws.close();
        resolve(false);
      });
      ws.on('unexpected-response', (_req, res) => {
        if (res.statusCode === 403) resolve(true);
        else resolve(false);
      });
      ws.on('error', () => {
        resolve(true);
      });
    });
    assert(wsRejected, 'WebSocket connection with unauthorized Origin must be rejected with 403');
    console.log('✓ PASS: Foreign Origin rejected on WebSocket upgrade with HTTP 403 Forbidden.');

    // TEST 3/4b: WebSocket join must reject guessable IDs and malformed tokens
    console.log('\n[Test 4b] WebSocket join: guessable mc_ ID cannot bypass the HTTP token check');
    const wsMcError = await wsJoinError('mc_1730000000000');
    assert(
      wsMcError === 'Invalid callback token',
      `Expected "Invalid callback token" over WS, got ${JSON.stringify(wsMcError)}`
    );
    const wsMalformedError = await wsJoinError('not-a-valid-token');
    assert(
      wsMalformedError === 'Invalid callback token',
      `Expected malformed token rejection over WS, got ${JSON.stringify(wsMalformedError)}`
    );
    const unknownHexToken = '0'.repeat(32);
    const wsUnknownError = await wsJoinError(unknownHexToken);
    assert(
      wsUnknownError === 'Callback session not found',
      `Expected unknown token rejection over WS, got ${JSON.stringify(wsUnknownError)}`
    );
    console.log('✓ PASS: WebSocket join accepts only existing opaque 128-bit tokens.');

    // TEST 5: Legacy / guessable IDs rejected
    console.log('\n[Test 5] Call tokens: guessable IDs rejected');
    const guessableRes = await fetch(`${BASE_URL}/api/call-token/mc_1730000000000`);
    assert(guessableRes.status === 400, `Expected 400 for guessable mc_ ID, got ${guessableRes.status}`);
    console.log('✓ PASS: Legacy guessable ID "mc_..." rejected with 400 Bad Request.');

    // TEST 6: Simulation creates unguessable 128-bit hex token
    console.log('\n[Test 6] Token creation: simulate generates secure 128-bit callback token');
    const simRes = await fetch(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.12',
      },
      body: JSON.stringify({ phone: '+1 (555) 019-9999', source: 'test' }),
    });
    assert(simRes.status === 200, `Expected 200 for simulate, got ${simRes.status}`);
    const simData = await simRes.json();
    assert(typeof simData.token === 'string' && simData.token.length >= 32, 'Token must be at least 128 bits (32 hex chars)');
    const testToken = simData.token;
    console.log(`✓ PASS: Unguessable token generated (${testToken.slice(0, 8)}...[32 chars]).`);

    // TEST 6b: Public token validation masks the phone number
    console.log('\n[Test 6b] Privacy: token validation response masks the customer phone');
    const tokenInfoRes = await fetch(`${BASE_URL}/api/call-token/${testToken}`);
    assert(tokenInfoRes.status === 200, `Expected 200 for valid token, got ${tokenInfoRes.status}`);
    const tokenInfo = await tokenInfoRes.json();
    assert(typeof tokenInfo.customerPhone === 'string', 'Masked phone must be returned');
    assert(tokenInfo.customerPhone.includes('*'), `Expected masked phone, got ${tokenInfo.customerPhone}`);
    assert(!tokenInfo.customerPhone.includes('019-9999'), 'Full formatted phone must not be returned');
    console.log(`✓ PASS: Phone masked as ${tokenInfo.customerPhone}.`);

    // TEST 6c: SSE broadcasts must not include tokens or full phone numbers
    console.log('\n[Test 6c] Privacy: SSE missed_call event contains no token and a masked phone');
    const sseChunk = await captureMissedCallEvent(async () => {
      const res = await fetch(`${BASE_URL}/api/missed-calls/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.77',
        },
        body: JSON.stringify({ phone: '+1 (555) 017-4242', source: 'test' }),
      });
      assert(res.status === 200, `Expected 200 for SSE simulation, got ${res.status}`);
    });
    assert(sseChunk.includes('event: missed_call'), `Expected missed_call SSE event, got: ${sseChunk.slice(0, 200)}`);
    assert(sseChunk.includes('"customer_phone"'), 'SSE event should include masked customer_phone');
    assert(sseChunk.includes('******4242'), 'SSE event should keep only the last four digits');
    assert(!sseChunk.includes('555'), 'SSE event must not contain the full phone number');
    assert(!/"token"/.test(sseChunk), 'SSE event must not contain a callback token');
    console.log('✓ PASS: SSE payload is limited to the call id, source, and masked phone.');

    // TEST 6d: Dashboard list APIs mask phones while still returning callback tokens
    console.log('\n[Test 6d] Privacy: /api/missed-calls masks phones and does not leak full numbers');
    const listRes = await fetch(`${BASE_URL}/api/missed-calls`, {
      headers: { Origin: 'https://missed-call-rescuer.vercel.app' },
    });
    assert(listRes.status === 200, `Expected 200 for missed-calls list, got ${listRes.status}`);
    const listRows = await listRes.json() as Array<{ customer_phone?: string; token?: string }>;
    assert(Array.isArray(listRows) && listRows.length > 0, 'Missed-call list should contain rows');
    const listed = listRows.find((row) => row.token === testToken);
    assert(listed, 'Simulated call must appear in the public missed-call list');
    assert(typeof listed?.customer_phone === 'string' && listed.customer_phone.includes('*'), 'List phone must be masked');
    assert(!String(listed?.customer_phone).includes('019-9999'), 'List must not return the full formatted phone');
    console.log('✓ PASS: Public missed-call list returns masked phones.');

    // TEST 7: Call token single-use check
    console.log('\n[Test 7] Call token single-use: rejected after call has started');
    const db = new Database(TEMP_DB);
    db.prepare('UPDATE missed_calls SET call_started_at = ? WHERE token = ?').run(
      new Date().toISOString(),
      testToken
    );
    const reusedTokenRes = await fetch(`${BASE_URL}/api/call-token/${testToken}`);
    assert(reusedTokenRes.status === 409, `Expected 409 for reused call token, got ${reusedTokenRes.status}`);
    console.log('✓ PASS: Reused call link rejected with 409 Conflict.');

    // TEST 8: Call token 30-minute expiry check
    console.log('\n[Test 8] Call token expiration: links expire after 30 minutes');
    const expiredToken = 'e'.repeat(32);
    db.prepare(`
      INSERT INTO missed_calls (id, business_id, customer_phone, time, status, token, token_expires_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'mc_exp_1',
      'biz_1',
      '+15550001',
      new Date().toISOString(),
      'new',
      expiredToken,
      new Date(Date.now() - 60000).toISOString(),
      'test'
    );
    const expiredRes = await fetch(`${BASE_URL}/api/call-token/${expiredToken}`);
    assert(expiredRes.status === 410, `Expected 410 Gone for expired token, got ${expiredRes.status}`);
    console.log('✓ PASS: Expired token rejected with 410 Gone.');

    // TEST 9: Daily call cap enforcement (MAX_CALLS_PER_DAY=5)
    console.log('\n[Test 9] Daily budget cap: MAX_CALLS_PER_DAY (5) enforcement');
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO calls (id, missed_call_id, business_id, customer_phone, start_time)
        VALUES (?, ?, ?, ?, ?)
      `).run(`call_daily_${i}`, null, 'biz_1', '+15551234', new Date().toISOString());
    }
    const freshToken = 'f' + '0'.repeat(31);
    db.prepare(`
      INSERT INTO missed_calls (id, business_id, customer_phone, time, status, token, token_expires_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'mc_budget_test',
      'biz_1',
      '+15550002',
      new Date().toISOString(),
      'new',
      freshToken,
      new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      'test'
    );
    const budgetRes = await fetch(`${BASE_URL}/api/call-token/${freshToken}`);
    assert(budgetRes.status === 429, `Expected 429 for budget limit hit, got ${budgetRes.status}`);
    const budgetBody = await budgetRes.json();
    assert(budgetBody.error.includes('limit'), 'Error message should mention call limit');
    console.log('✓ PASS: Daily call cap triggered 429 ("Daily demo call limit reached").');

    // TEST 10: Trust proxy rate limit using X-Forwarded-For
    console.log('\n[Test 10] Trust proxy: rate limiting isolates client IP via X-Forwarded-For');
    const proxyIp = '203.0.113.195';
    let proxyRateLimited = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE_URL}/api/missed-calls/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': proxyIp,
        },
        body: JSON.stringify({ phone: '+1 (555) 000-0000', source: 'test' }),
      });
      if (res.status === 429) {
        proxyRateLimited = true;
        break;
      }
    }
    assert(proxyRateLimited, 'Simulate endpoint should rate-limit the specific forwarded IP');
    console.log('✓ PASS: Trust proxy accurately isolated and rate-limited client IP via X-Forwarded-For.');

    // TEST 11: Clear test data admin action (token-gated in production)
    console.log('\n[Test 11] Admin gating: clear-test-data requires x-admin-token');
    const unauthorizedClear = await fetch(`${BASE_URL}/api/admin/clear-test-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all' }),
    });
    assert(unauthorizedClear.status === 403, `Expected 403 without admin token, got ${unauthorizedClear.status}`);

    const clearRes = await fetch(`${BASE_URL}/api/admin/clear-test-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'test-admin-token',
      },
      body: JSON.stringify({ scope: 'all' }),
    });
    assert(clearRes.status === 200, `Expected 200 from clear-test-data, got ${clearRes.status}`);
    const remainingCalls = db.prepare('SELECT COUNT(*) as count FROM calls').get() as { count: number };
    const remainingBiz = db.prepare('SELECT COUNT(*) as count FROM businesses').get() as { count: number };
    assert(remainingCalls.count === 0, 'Calls should be cleared');
    assert(remainingBiz.count === 1, 'Business configuration must be preserved');
    console.log('✓ PASS: Test and demo calls cleared successfully while business configuration remained intact.');

    db.close();
    console.log('\n====================================================');
    console.log('🎉 ALL SECURITY TESTS PASSED!');
    console.log('====================================================\n');
  } catch (err: any) {
    console.error('Test execution failed:', err);
    if (serverOutput) {
      console.error('Child server output:\n', serverOutput);
    }
    cleanup();
    process.exit(1);
  } finally {
    cleanup();
  }
}

runSecuritySuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
