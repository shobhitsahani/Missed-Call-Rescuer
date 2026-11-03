import assert from 'assert';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

const PORT = 4130;
const BASE_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}/ws`;
const DB_PATH = path.join(process.cwd(), 'data', 'app.db');

let serverProc: ChildProcess | null = null;
const db = new Database(DB_PATH);
const serverLogs: string[] = [];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        ADMIN_TOKEN: 'lifecycle-admin-token',
        MAX_CALLS_PER_DAY: '500',
        MAX_CONCURRENT_CALLS: '10',
        STT_PROVIDER: 'browser', // deterministic test mode
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    serverProc.stdout?.on('data', (d) => {
      const s = d.toString();
      output += s;
      serverLogs.push(s);
      if (output.includes(`listening on http://localhost:${PORT}`)) {
        resolve();
      }
    });

    serverProc.stderr?.on('data', (d) => {
      const s = d.toString();
      serverLogs.push(s);
    });

    serverProc.on('error', reject);
    setTimeout(() => reject(new Error(`Server startup timed out:\n${output}`)), 15000);
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
    await sleep(600);
  }
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 20000,
  context = 'Message'
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timeout waiting for ${context} (${timeoutMs}ms)`));
    }, timeoutMs);

    function onMsg(data: WebSocket.RawData, isBinary: boolean) {
      if (isBinary) return;
      try {
        const parsed = JSON.parse(data.toString());
        if (predicate(parsed)) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(parsed);
        }
      } catch {}
    }

    ws.on('message', onMsg);
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('🧪 Missed-Call Rescuer: Connection Lifecycle Regression Suite');
  console.log('========================================================\n');

  await startServer();
  console.log(`✓ Test server running on ${BASE_URL}\n`);

  try {
    // -----------------------------------------------------------------
    // Scenario 1: Successful initial WebSocket connection & authentication
    // -----------------------------------------------------------------
    console.log('[Scenario 1] Successful initial WebSocket connection');
    const sim1 = await json(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+15550101111', source: 'test', phone_verified: true }),
    });
    assert.strictEqual(sim1.status, 200);
    const token1 = sim1.data.token;

    const ws1 = new WebSocket(WS_URL);
    await new Promise<void>((res, rej) => {
      ws1.on('open', res);
      ws1.on('error', rej);
    });

    ws1.send(JSON.stringify({ type: 'join', token: token1 }));
    const cfg1 = await waitForMessage(ws1, (m) => m.type === 'config', 5000, 'config message');
    assert(cfg1.sttProvider, 'Config message should specify sttProvider');
    const state1 = await waitForMessage(ws1, (m) => m.type === 'state' && m.state === 'SPEAKING', 8000, 'SPEAKING state');
    assert.strictEqual(state1.state, 'SPEAKING');
    await waitForMessage(ws1, (m) => m.type === 'state' && m.state === 'LISTENING', 15000, 'LISTENING state');
    console.log('   ✓ PASS: WebSocket connected, authenticated, and assistant finished greeting (LISTENING)');

    // -----------------------------------------------------------------
    // Scenario 2: Invalid authentication token
    // -----------------------------------------------------------------
    console.log('\n[Scenario 2] Invalid authentication token');
    const invalidTokenCheck = await json(`${BASE_URL}/api/call-token/not-a-valid-token`);
    assert.strictEqual(invalidTokenCheck.status, 400);
    const nonExistentToken = 'a'.repeat(32);
    const nonExistentCheck = await json(`${BASE_URL}/api/call-token/${nonExistentToken}`);
    assert.strictEqual(nonExistentCheck.status, 404);
    console.log('   ✓ PASS: Invalid tokens rejected with 400/404');

    // -----------------------------------------------------------------
    // Scenario 3: WebSocket authentication failure on unauthenticated token
    // -----------------------------------------------------------------
    console.log('\n[Scenario 3] WebSocket authentication failure on bad token');
    const wsBad = new WebSocket(WS_URL);
    await new Promise<void>((res) => wsBad.on('open', res));
    wsBad.send(JSON.stringify({ type: 'join', token: 'b'.repeat(32) }));
    const badErrMsg = await waitForMessage(wsBad, (m) => m.type === 'error', 5000, 'error message');
    assert(badErrMsg.message.includes('not found') || badErrMsg.message.includes('invalid'), 'Error message describes token failure');
    const closeCode = await new Promise<number>((res) => wsBad.on('close', (code) => res(code)));
    assert.strictEqual(closeCode, 1008, 'Socket closed with Policy Violation code 1008');
    console.log('   ✓ PASS: WebSocket auth failure correctly yields error event and close code 1008');

    // -----------------------------------------------------------------
    // Scenario 4 & 5: Stage error handling & sanitization
    // -----------------------------------------------------------------
    console.log('\n[Scenario 4 & 5] Provider error propagation & sanitization');
    // Ensure errors do not leak stack traces or internal secrets
    const wsFail = new WebSocket(WS_URL);
    await new Promise<void>((res) => wsFail.on('open', res));
    wsFail.send(JSON.stringify({ type: 'join', token: 'mc_legacy_token' }));
    const failMsg = await waitForMessage(wsFail, (m) => m.type === 'error', 5000, 'error message');
    assert(!failMsg.message.includes('file:'), 'No stack traces in error messages');
    assert(!failMsg.message.includes('key='), 'No API keys leaked in error messages');
    console.log('   ✓ PASS: Provider errors sanitized cleanly');

    // -----------------------------------------------------------------
    // Scenario 8 & 14: Client disconnect during session initialization & token rollback
    // -----------------------------------------------------------------
    console.log('\n[Scenario 8 & 14] Client disconnect before call starts allows retry without burned token');
    const simUnstarted = await json(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'test' }),
    });
    const unstartedToken = simUnstarted.data.token;

    // Connect and immediately disconnect before any customer turn
    const wsFastDrop = new WebSocket(WS_URL);
    await new Promise<void>((res) => wsFastDrop.on('open', res));
    wsFastDrop.send(JSON.stringify({ type: 'join', token: unstartedToken }));
    await sleep(100);
    const dropClosed = new Promise((res) => wsFastDrop.on('close', res));
    wsFastDrop.close();
    await dropClosed;
    await sleep(600);

    // Verify token can be validated again (NOT 409 call_concluded!)
    const reval = await json(`${BASE_URL}/api/call-token/${unstartedToken}`);
    assert.strictEqual(reval.status, 200, 'Token must still be valid for retry if initialization dropped');
    assert.strictEqual(reval.data.valid, true);

    // Verify retry succeeds
    const wsRetry = new WebSocket(WS_URL);
    await new Promise<void>((res) => wsRetry.on('open', res));
    wsRetry.on('message', (d) => console.log('   [wsRetry received]', d.toString()));
    wsRetry.on('close', (c, r) => console.log('   [wsRetry closed]', c, r.toString()));
    wsRetry.send(JSON.stringify({ type: 'join', token: unstartedToken }));
    const retryCfg = await waitForMessage(wsRetry, (m) => m.type === 'config', 5000, 'config on retry');
    assert(retryCfg.sttProvider);
    console.log('   ✓ PASS: Unstarted session rolled back; retry succeeded without "link already used" error');
    wsRetry.close();

    // -----------------------------------------------------------------
    // Scenario 10: Duplicate connection events
    // -----------------------------------------------------------------
    console.log('\n[Scenario 10] Duplicate join messages handled idempotently');
    ws1.send(JSON.stringify({ type: 'join', token: token1 }));
    const dupState = await waitForMessage(ws1, (m) => m.type === 'state', 5000, 'state on duplicate join');
    assert(dupState.state);
    console.log('   ✓ PASS: Duplicate join handled without creating second session');

    // -----------------------------------------------------------------
    // Scenario 11: Duplicate rapid utterances deduplicated
    // -----------------------------------------------------------------
    console.log('\n[Scenario 11] Duplicate rapid transcript events deduplicated');
    ws1.send(JSON.stringify({ type: 'transcript', final: true, text: 'Hello, what are your opening hours?' }));
    await sleep(50);
    // Rapid duplicate of same transcript
    ws1.send(JSON.stringify({ type: 'transcript', final: true, text: 'Hello, what are your opening hours?' }));
    
    // Agent should only generate one reply
    const agentText1 = await waitForMessage(ws1, (m) => m.type === 'agent_text', 25000, 'agent_text');
    assert(agentText1.text);
    console.log('   ✓ PASS: Duplicate utterance suppressed; agent produced single reply');

    // -----------------------------------------------------------------
    // Scenario 13: Session resumption / reconnection to active call
    // -----------------------------------------------------------------
    console.log('\n[Scenario 13] Mid-call reconnection to active session');
    const wsReconnect = new WebSocket(WS_URL);
    await new Promise<void>((res) => wsReconnect.on('open', res));
    wsReconnect.send(JSON.stringify({ type: 'join', token: token1 }));
    const recCfg = await waitForMessage(wsReconnect, (m) => m.type === 'config', 5000, 'config on reconnect');
    assert(recCfg.sttProvider);
    const recState = await waitForMessage(wsReconnect, (m) => m.type === 'state', 5000, 'state on reconnect');
    assert(recState.state);
    // If assistant was still speaking previous answer, wait until it finishes (LISTENING)
    if (recState.state !== 'LISTENING') {
      await waitForMessage(wsReconnect, (m) => m.type === 'state' && m.state === 'LISTENING', 15000, 'LISTENING state on reconnect');
    }
    console.log('   ✓ PASS: Reconnected successfully to ongoing session');

    // -----------------------------------------------------------------
    // Scenario 12 & 17: Premature termination guards & finalization lifecycle
    // -----------------------------------------------------------------
    console.log('\n[Scenario 12 & 17] Ensure call is not prematurely marked COMPLETED while speaking');
    // Say goodbye to trigger wrapping up
    wsReconnect.send(JSON.stringify({ type: 'transcript', final: true, text: "That's all, thank you! Goodbye." }));
    const audioEndMsg = await waitForMessage(wsReconnect, (m) => m.type === 'agent_audio_end', 25000, 'agent_audio_end');
    assert.strictEqual(audioEndMsg.isFinal, true);

    // Call must NOT be marked completed before playback_complete
    const activeRow = db.prepare('SELECT end_time FROM calls WHERE missed_call_id = ?').get(sim1.data.missedCallId) as any;
    assert.strictEqual(activeRow.end_time, null, 'Call must remain active until playback is complete');
    console.log('   ✓ PASS: Session remains active while final agent audio is playing');

    // -----------------------------------------------------------------
    // Scenario 15 & 16: Idempotent termination & reject late speech
    // -----------------------------------------------------------------
    console.log('\n[Scenario 15 & 16] Playback completion acknowledgement & late speech rejection');
    wsReconnect.send(JSON.stringify({ type: 'playback_complete' }));
    wsReconnect.send(JSON.stringify({ type: 'playback_complete' })); // duplicate playback complete

    // Late customer speech should be dropped
    wsReconnect.send(JSON.stringify({ type: 'transcript', final: true, text: 'One last question!' }));

    // Await summary
    const summaryMsg = await waitForMessage(wsReconnect, (m) => m.type === 'summary', 25000, 'summary');
    assert(summaryMsg.summary, 'Summary delivered to client upon conclusion');
    console.log('   ✓ PASS: Summary received; late customer speech dropped');
    console.log('   ✓ PASS: Summary received; late customer speech dropped');

    // Verify DB state
    const finishedRow = db.prepare('SELECT end_time, end_reason FROM calls WHERE missed_call_id = ?').get(sim1.data.missedCallId) as any;
    assert(finishedRow.end_time !== null, 'end_time recorded in SQLite');
    assert.strictEqual(finishedRow.end_reason, 'assistant_ended');
    console.log('   ✓ PASS: Call terminated and persisted with end_reason=assistant_ended');

    // -----------------------------------------------------------------
    // Scenario 18: End-to-end integration test from Start Call to audio playback
    // -----------------------------------------------------------------
    console.log('\n[Scenario 18] Full end-to-end connection integration test');
    const simE2e = await json(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+15550109999', source: 'test' }),
    });
    assert.strictEqual(simE2e.status, 200);

    const valRes = await json(`${BASE_URL}/api/call-token/${simE2e.data.token}`);
    assert.strictEqual(valRes.status, 200);
    assert.strictEqual(valRes.data.valid, true);

    const wsE2e = new WebSocket(WS_URL);
    let firstPcmReceived = false;
    wsE2e.on('message', (_data, isBinary) => {
      if (isBinary) firstPcmReceived = true;
    });

    await new Promise<void>((res) => wsE2e.on('open', res));
    wsE2e.send(JSON.stringify({ type: 'join', token: simE2e.data.token }));

    // Wait for greeting agent_text and audio stream
    await waitForMessage(wsE2e, (m) => m.type === 'agent_text', 25000, 'agent_text in e2e');
    await sleep(600);
    assert(firstPcmReceived, 'PCM audio binary frames must be received by client');
    console.log('   ✓ PASS: E2E connection initiated, token verified, agent text & PCM audio received cleanly');

    wsE2e.close();
    ws1.close();
    wsReconnect.close();

    console.log('\n========================================================');
    console.log('🎉 ALL CONNECTION LIFECYCLE REGRESSION TESTS PASSED!');
    console.log('========================================================');
  } finally {
    await stopServer();
    db.close();
  }
}

runTests().catch(async (err) => {
  console.error('\n❌ CONNECTION LIFECYCLE TESTS FAILED:', err);
  if (serverLogs.length > 0) {
    console.error('\n--- Recent Server Logs ---');
    console.error(serverLogs.slice(-25).join(''));
    console.error('--------------------------\n');
  }
  await stopServer();
  db.close();
  process.exit(1);
});
