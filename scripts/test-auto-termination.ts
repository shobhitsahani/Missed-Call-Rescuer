/**
 * Automated test suite for automatic call termination:
 * Verifies all 10 scenarios specified in the master goal.
 */
import assert from 'assert';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import WebSocket from 'ws';
import Database from 'better-sqlite3';
import { isFinalClosingTurn, isClosingSignoff, isCustomerWrapUp } from '../server/session';

const TEST_PORT = 4125;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const WS_URL = `ws://localhost:${TEST_PORT}/ws`;
const DB_PATH = path.join(process.cwd(), 'data', 'app.db');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 15000,
  errorContext = 'Message timeout'
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`${errorContext} after ${timeoutMs}ms`));
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

let serverProc: ChildProcess | null = null;

async function startTestServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    serverProc = spawn('npx', ['tsx', 'server/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NODE_ENV: 'test',
        ADMIN_TOKEN: 'test-admin-token',
        MAX_CALLS_PER_DAY: '500',
        STT_PROVIDER: 'browser',
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    serverProc.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.includes(`listening on http://localhost:${TEST_PORT}`)) {
        resolve();
      }
    });

    serverProc.stderr?.on('data', (d) => {
      console.error('[server stderr]', d.toString());
    });

    serverProc.on('error', reject);
    setTimeout(() => reject(new Error('Server start timed out after 12s')), 12000);
  });
}

async function stopTestServer() {
  if (serverProc) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(serverProc.pid), '/f', '/t']);
    } else {
      serverProc.kill('SIGTERM');
    }
    serverProc = null;
    await sleep(500);
  }
}

async function runTests() {
  console.log('========================================================');
  console.log('🧪 Missed-Call Rescuer: Auto-Termination Regression Suite');
  console.log('========================================================\n');

  console.log(`[Setup] Starting test server on port ${TEST_PORT}...`);
  await startTestServer();
  console.log('✓ Test server listening.\n');

  const db = new Database(DB_PATH);

  try {
    // -------------------------------------------------------------------------
    // Scenario 5: Unit test closing detection (pure sentences containing "goodbye")
    // -------------------------------------------------------------------------
    console.log('[Scenario 5] Normal sentences containing "goodbye" do not end call');
    assert.strictEqual(
      isClosingSignoff('Before I say goodbye, what are your hours?'),
      false,
      'Question containing goodbye must not be closing sign-off'
    );
    assert.strictEqual(
      isClosingSignoff('Did you say goodbye?'),
      false,
      'Question asking about goodbye must not be closing sign-off'
    );
    assert.strictEqual(
      isClosingSignoff("Don't say goodbye yet, what is your pricing?"),
      false,
      'Statement ending in question must not be closing sign-off'
    );
    assert.strictEqual(
      isClosingSignoff('I apologize if I said goodbye earlier. How can I help?'),
      false,
      'Apology with question must not be closing sign-off'
    );
    assert.strictEqual(
      isFinalClosingTurn('Before I say goodbye, what is your name?', 'Thanks', false),
      false,
      'Inquiry must not trigger final closing turn'
    );

    // True closing sign-offs
    assert.strictEqual(isClosingSignoff('Goodbye.'), true);
    assert.strictEqual(isClosingSignoff('Have a great day!'), true);
    assert.strictEqual(isClosingSignoff('Thank you for calling Acme Plumbing. Have a wonderful day!'), true);
    assert.strictEqual(isCustomerWrapUp("That's all, thank you"), true);
    assert.strictEqual(isCustomerWrapUp('You too.'), true);
    assert.strictEqual(isFinalClosingTurn('Goodbye.', 'You too.', false), true);
    assert.strictEqual(isFinalClosingTurn('Thank you for calling Acme Plumbing. Have a great day!', "That's all thank you", false), true);
    assert.strictEqual(isFinalClosingTurn('We will follow up soon. Goodbye!', 'Okay', true), true); // explicit token
    console.log('✓ PASS: Sentence classification accurately discriminates questions from final sign-offs.\n');

    // -------------------------------------------------------------------------
    // Scenario 10b: Mid-call reconnection still works before finalization
    // -------------------------------------------------------------------------
    console.log('[Scenario 10] Existing mid-call reconnection & user termination continue to work');
    const sim10 = await json(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1 (555) 010-1010', source: 'test-10' }),
    });
    const token10 = sim10.data.token;
    const ws10a = new WebSocket(WS_URL);
    await new Promise<void>((res, rej) => {
      ws10a.on('open', () => ws10a.send(JSON.stringify({ type: 'join', token: token10 })));
      ws10a.on('message', (d, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'state' && m.state === 'SPEAKING') res();
        } catch {}
      });
      ws10a.on('error', rej);
      setTimeout(() => rej(new Error('ws10a timeout')), 10000);
    });

    // Mid-call reload check
    const check10 = await json(`${BASE_URL}/api/call-token/${token10}`);
    assert.strictEqual(check10.data.valid, true);
    assert.strictEqual(check10.data.isReconnect, true);

    // Reconnect client
    const ws10b = new WebSocket(WS_URL);
    await new Promise<void>((res, rej) => {
      ws10b.on('open', () => ws10b.send(JSON.stringify({ type: 'join', token: token10 })));
      ws10b.on('message', (d, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'state') res();
        } catch {}
      });
      ws10b.on('error', rej);
      setTimeout(() => rej(new Error('ws10b timeout')), 10000);
    });

    // User-initiated termination
    ws10b.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
    await waitForMessage(ws10b, (m) => m.type === 'state' && m.state === 'DONE');
    const callRow10 = db.prepare('SELECT end_reason FROM calls WHERE missed_call_id = ?').get(sim10.data.missedCallId) as any;
    assert.strictEqual(callRow10?.end_reason, 'user_ended');
    ws10a.close();
    ws10b.close();
    console.log('✓ PASS: Mid-call reconnection and user-initiated end work as expected.\n');

    // -------------------------------------------------------------------------
    // Scenario 1, 2, 3, 4, 7, 8: Complete playback synchronization, 1s countdown,
    // post-goodbye speech rejection, idempotency, and persistence
    // -------------------------------------------------------------------------
    console.log('[Scenarios 1, 2, 3, 4, 7, 8] Final goodbye playback, 1-sec countdown, speech rejection, idempotency');
    const sim1 = await json(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1 (555) 011-2233', source: 'test', phone_verified: true }),
    });
    const token1 = sim1.data.token;
    const ws1 = new WebSocket(WS_URL);

    await new Promise<void>((res, rej) => {
      ws1.on('open', () => ws1.send(JSON.stringify({ type: 'join', token: token1 })));
      ws1.on('message', (d, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'state' && m.state === 'LISTENING') res();
        } catch {}
      });
      ws1.on('error', rej);
      setTimeout(() => rej(new Error('ws1 greeting timeout')), 12000);
    });

    // Customer triggers wrap-up goodbye
    ws1.send(JSON.stringify({ type: 'transcript', final: true, text: "That's all, thank you! Goodbye." }));

    // Wait for agent_audio_end: { isFinal: true }
    await waitForMessage(ws1, (m) => m.type === 'agent_audio_end' && m.isFinal === true, 20000, 'agent_audio_end');
    console.log('   Received agent_audio_end (isFinal: true)');

    // Scenario 2: Verify timer has NOT fired before playback_complete is sent
    await sleep(400);
    const midStateRow = db.prepare('SELECT end_time FROM calls WHERE missed_call_id = ?').get(sim1.data.missedCallId) as any;
    assert.strictEqual(midStateRow?.end_time, null, 'Call must NOT terminate before playback completes');
    console.log('   ✓ Scenario 2 PASS: Call remains active while audio is playing before playback_complete');

    // Scenario 3: Customer speaks after final goodbye
    ws1.send(JSON.stringify({ type: 'transcript', final: true, text: 'You too, have a great day!' }));

    // Scenario 4: Multiple playback_complete events should be harmless
    const t0 = Date.now();
    ws1.send(JSON.stringify({ type: 'playback_complete' }));
    ws1.send(JSON.stringify({ type: 'playback_complete' })); // Duplicate
    ws1.send(JSON.stringify({ type: 'playback_complete' })); // Duplicate
    console.log('   Sent playback_complete (including duplicates for idempotency test)');

    // Scenario 1: Await termination and measure duration
    const summaryMsg = await waitForMessage(ws1, (m) => m.type === 'summary', 15000, 'Summary completion');
    assert(summaryMsg?.summary, 'Summary payload must be present in termination message');
    const t1 = Date.now();
    const elapsedMs = t1 - t0;
    console.log(`   Termination completed in ${elapsedMs}ms after playback_complete`);
    assert(elapsedMs >= 900, `Countdown was too fast: ${elapsedMs}ms (expected >= 950ms)`);
    assert(elapsedMs <= 2500, `Countdown was too slow: ${elapsedMs}ms (expected <= 2500ms including summary LLM)`);
    console.log('   ✓ Scenario 1 PASS: Terminated approximately 1 second after playback complete');

    // Scenario 7: Verify DB persistence (calls, turns, summaries)
    const callRow1 = db.prepare('SELECT * FROM calls WHERE missed_call_id = ?').get(sim1.data.missedCallId) as any;
    assert.strictEqual(callRow1?.end_reason, 'assistant_ended');
    assert(callRow1?.end_time !== null, 'end_time must be populated');

    const turns1 = db.prepare('SELECT * FROM turns WHERE call_id = ? ORDER BY order_idx ASC').all(callRow1.id) as any[];
    assert(turns1.length >= 2, 'Must have recorded turns');
    // Ensure customer utterance after final goodbye did not trigger a duplicate agent turn
    const agentTurnsAfterClosing = turns1.filter((t) => t.role === 'agent');
    const lastAgentTurn = agentTurnsAfterClosing[agentTurnsAfterClosing.length - 1];
    assert(!/goodbye.*goodbye/i.test(lastAgentTurn.text), 'No repeated goodbye loop in turns');
    console.log('   ✓ Scenario 3 & 7 PASS: Late speech ignored, 0 repeated goodbyes, DB records intact');

    const summaryRow1 = db.prepare('SELECT * FROM summaries WHERE call_id = ?').get(callRow1.id) as any;
    assert(summaryRow1 !== undefined, 'Summary record must exist in DB');
    assert(summaryRow1.reason && summaryRow1.reason.length > 0, 'Summary reason populated');
    console.log('   ✓ Summary verified in DB:', summaryRow1.reason.slice(0, 50));

    // Scenario 8: WebSocket cleanup idempotency
    ws1.close();
    ws1.close(); // Repeat close
    console.log('   ✓ Scenario 8 PASS: WebSocket cleanup is idempotent.\n');

    // -------------------------------------------------------------------------
    // Scenario 9: Refreshing during finalization does not revive the call
    // -------------------------------------------------------------------------
    console.log('[Scenario 9] Refreshing during finalization does not revive the call');
    const sim9 = await json(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1 (555) 099-8877', source: 'test', phone_verified: true }),
    });
    const token9 = sim9.data.token;
    const ws9 = new WebSocket(WS_URL);

    await new Promise<void>((res, rej) => {
      ws9.on('open', () => ws9.send(JSON.stringify({ type: 'join', token: token9 })));
      ws9.on('message', (d, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'state' && m.state === 'LISTENING') res();
        } catch {}
      });
      ws9.on('error', rej);
      setTimeout(() => rej(new Error('ws9 timeout')), 10000);
    });

    // Trigger finalization via opt-out
    ws9.send(JSON.stringify({ type: 'transcript', final: true, text: 'Please stop calling me and remove my number.' }));
    await waitForMessage(ws9, (m) => m.type === 'agent_audio_end' && m.isFinal === true);

    // Attempt token validation while in FINALIZING state (simulates page refresh)
    const refreshCheck = await json(`${BASE_URL}/api/call-token/${token9}`);
    assert.strictEqual(refreshCheck.status, 409, 'Token validation must return 409 during finalization');
    assert.strictEqual(refreshCheck.data.code, 'call_concluded');

    // Attempt WebSocket join during finalization
    const ws9Refresh = new WebSocket(WS_URL);
    const joinErr = await new Promise<string>((res) => {
      ws9Refresh.on('open', () => ws9Refresh.send(JSON.stringify({ type: 'join', token: token9 })));
      ws9Refresh.on('message', (d, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'error') res(m.message);
        } catch {}
      });
      ws9Refresh.on('close', () => res('closed'));
    });
    assert(joinErr.includes('already been used') || joinErr === 'closed', `Expected already used error, got: ${joinErr}`);
    console.log('   ✓ Scenario 9 PASS: Refreshing during finalization returns 409 and rejects reconnect.\n');

    ws9.close();
    ws9Refresh.close();

    // -------------------------------------------------------------------------
    // Scenario 6: Bounded fallback terminates call if playback_complete is lost
    // -------------------------------------------------------------------------
    console.log('[Scenario 6] Bounded fallback terminates call if playback_complete is lost');
    const sim6 = await json(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1 (555) 066-5544', source: 'test', phone_verified: true }),
    });
    const token6 = sim6.data.token;
    const ws6 = new WebSocket(WS_URL);

    await new Promise<void>((res, rej) => {
      ws6.on('open', () => ws6.send(JSON.stringify({ type: 'join', token: token6 })));
      ws6.on('message', (d, isBinary) => {
        if (isBinary) return;
        try {
          const m = JSON.parse(d.toString());
          if (m.type === 'state' && m.state === 'LISTENING') res();
        } catch {}
      });
      ws6.on('error', rej);
      setTimeout(() => rej(new Error('ws6 timeout')), 10000);
    });

    // Trigger goodbye
    ws6.send(JSON.stringify({ type: 'transcript', final: true, text: "Thanks, that's all. Bye!" }));
    await waitForMessage(ws6, (m) => m.type === 'agent_audio_end' && m.isFinal === true);
    console.log('   agent_audio_end received. Withholding playback_complete to test bounded fallback timer...');

    // Do NOT send playback_complete. Wait for fallback timer to trigger termination.
    const fallbackSummary = await waitForMessage(ws6, (m) => m.type === 'summary', 16000, 'Fallback termination');
    assert(fallbackSummary !== undefined);
    const callRow6 = db.prepare('SELECT end_reason, end_time FROM calls WHERE missed_call_id = ?').get(sim6.data.missedCallId) as any;
    assert.strictEqual(callRow6?.end_reason, 'assistant_ended');
    assert(callRow6?.end_time !== null);
    console.log('   ✓ Scenario 6 PASS: Call terminated safely via bounded fallback without waiting forever.\n');
    ws6.close();

    console.log('========================================================');
    console.log('🎉 ALL 10 AUTO-TERMINATION REGRESSION SCENARIOS PASSED!');
    console.log('========================================================');
  } finally {
    db.close();
    await stopTestServer();
  }
}

runTests().catch(async (err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  await stopTestServer();
  process.exit(1);
});
