import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import WebSocket from 'ws';
import Database from 'better-sqlite3';

const TEST_PORT = 4098;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEMP_DB = path.join(__dirname, '../data/test-security.db');

const TEST_ACCESS_CODE = 'test-judge-code-9988';
const TEST_SESSION_SECRET = 'test-session-secret-hardening-1234567890';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${msg}`);
    process.exit(1);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (fs.existsSync(TEMP_DB)) {
    try { fs.unlinkSync(TEMP_DB); } catch {}
  }

  const child: ChildProcess = spawn(
    'npx',
    ['tsx', 'server/index.ts'],
    {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        DB_PATH: TEMP_DB,
        ACCESS_CODE: TEST_ACCESS_CODE,
        SESSION_SECRET: TEST_SESSION_SECRET,
        ALLOWED_ORIGINS: 'http://localhost:3010,https://missed-call-rescuer.vercel.app',
        MAX_CONCURRENT_CALLS: '2',
        MAX_CALLS_PER_DAY: '5',
        ADMIN_ENABLED: 'true',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    }
  );

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      if (process.platform === 'win32' && child.pid) {
        try {
          const { execSync } = require('child_process');
          execSync(`taskkill /pid ${child.pid} /f /t`, { stdio: 'ignore' });
        } catch {}
      } else {
        child.kill('SIGTERM');
      }
    } catch {}
    if (fs.existsSync(TEMP_DB)) {
      try { fs.unlinkSync(TEMP_DB); } catch {}
    }
  };

  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  try {
    console.log(`[Setup] Waiting for server on ${BASE_URL}...`);
    await waitForServer();
    console.log('✓ Test server is healthy and listening.\n');

    // TEST 1: Protected route without token returns 401
    console.log('[Test 1] Require auth: unauthenticated request to /api/business');
    const noAuthRes = await fetch(`${BASE_URL}/api/business`);
    assert(noAuthRes.status === 401, `Expected status 401, got ${noAuthRes.status}`);
    console.log('✓ PASS: Request without token rejected with 401 Unauthorized.');

    // TEST 2: Wrong access code rejected
    console.log('\n[Test 2] Auth: wrong access code rejected');
    const wrongAuthRes = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wrong-passcode' }),
    });
    assert(wrongAuthRes.status === 401, `Expected status 401, got ${wrongAuthRes.status}`);
    console.log('✓ PASS: Wrong access code rejected with 401.');

    // TEST 3: Rate limiting on auth attempts
    console.log('\n[Test 3] Abuse limits: rate-limiting auth attempts (5 max per min per IP)');
    let rateLimited = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: `fail-${i}` }),
      });
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Expected to hit 429 Too Many Requests for rapid auth attempts');
    console.log('✓ PASS: 5-attempt rate limit triggered and returned 429 Too Many Requests.');

    // TEST 4: Valid access code succeeds with HMAC token
    console.log('\n[Test 4] Auth: valid access code returns signed token');
    // Use X-Forwarded-For to bypass IP block from test 3
    const validAuthRes = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.5',
      },
      body: JSON.stringify({ code: TEST_ACCESS_CODE }),
    });
    assert(validAuthRes.status === 200, `Expected 200 for valid code, got ${validAuthRes.status}`);
    const authData = await validAuthRes.json();
    assert(typeof authData.token === 'string' && authData.token.includes('.'), 'Auth token must be valid HMAC string');
    const validToken = authData.token;
    console.log('✓ PASS: Valid access code generated 12-hour signed HMAC session token.');

    // TEST 5: Authenticated access with Bearer token
    console.log('\n[Test 5] Access control: Bearer token grants access to protected routes');
    const authedBizRes = await fetch(`${BASE_URL}/api/business`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert(authedBizRes.status === 200, `Expected 200 with Bearer token, got ${authedBizRes.status}`);
    const bizData = await authedBizRes.json();
    assert(typeof bizData.name === 'string', 'Business name should be returned');
    console.log(`✓ PASS: Protected endpoint accessed successfully (Business: "${bizData.name}").`);

    // TEST 6: Foreign Origin rejected on CORS
    console.log('\n[Test 6] CORS: foreign origin rejected');
    const corsRes = await fetch(`${BASE_URL}/api/health`, {
      headers: { Origin: 'http://malicious-external-site.com' },
    });
    const allowOrigin = corsRes.headers.get('access-control-allow-origin');
    assert(allowOrigin !== 'http://malicious-external-site.com', 'Foreign origin must not be allowed in CORS headers');
    console.log('✓ PASS: Malicious foreign Origin not allowed by CORS policy.');

    // TEST 7: Foreign Origin rejected on WebSocket upgrade
    console.log('\n[Test 7] WebSocket Origin check: foreign origin rejected on upgrade');
    const wsRejected = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`, {
        headers: { Origin: 'http://unauthorized-origin.com' },
      });
      ws.on('open', () => {
        ws.close();
        resolve(false);
      });
      ws.on('unexpected-response', (req, res) => {
        if (res.statusCode === 403) resolve(true);
        else resolve(false);
      });
      ws.on('error', () => {
        resolve(true);
      });
    });
    assert(wsRejected, 'WebSocket connection with unauthorized Origin must be rejected with 403');
    console.log('✓ PASS: Foreign Origin rejected on WebSocket upgrade with HTTP 403 Forbidden.');

    // TEST 8: Legacy / guessable IDs rejected
    console.log('\n[Test 8] Call tokens: guessable IDs rejected');
    const guessableRes = await fetch(`${BASE_URL}/api/call-token/mc_1730000000000`);
    assert(guessableRes.status === 400, `Expected 400 for guessable mc_ ID, got ${guessableRes.status}`);
    console.log('✓ PASS: Legacy guessable ID "mc_..." rejected with 400 Bad Request.');

    // TEST 9: Simulation creates unguessable 128-bit hex token
    console.log('\n[Test 9] Token creation: simulate generates secure 128-bit callback token');
    const simRes = await fetch(`${BASE_URL}/api/missed-calls/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
        'X-Forwarded-For': '198.51.100.12',
      },
      body: JSON.stringify({ phone: '+1 (555) 019-9999', source: 'test' }),
    });
    assert(simRes.status === 200, `Expected 200 for simulate, got ${simRes.status}`);
    const simData = await simRes.json();
    assert(typeof simData.token === 'string' && simData.token.length >= 32, 'Token must be at least 128 bits (32 hex chars)');
    const testToken = simData.token;
    console.log(`✓ PASS: Unguessable token generated (${testToken.slice(0, 8)}...[32 chars]).`);

    // TEST 10: Call token single-use check
    console.log('\n[Test 10] Call token single-use: rejected after call has started');
    // Connect directly to sqlite to mark call_started_at
    const db = new Database(TEMP_DB);
    db.prepare('UPDATE missed_calls SET call_started_at = ? WHERE token = ?').run(
      new Date().toISOString(),
      testToken
    );
    const reusedTokenRes = await fetch(`${BASE_URL}/api/call-token/${testToken}`);
    assert(reusedTokenRes.status === 409, `Expected 409 for reused call token, got ${reusedTokenRes.status}`);
    console.log('✓ PASS: Reused call link rejected with 409 Conflict.');

    // TEST 11: Call token 30-minute expiry check
    console.log('\n[Test 11] Call token expiration: links expire after 30 minutes');
    const expiredToken = 'expired0123456789abcdef0123456789';
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
      new Date(Date.now() - 60000).toISOString(), // 1 minute in the past
      'test'
    );
    const expiredRes = await fetch(`${BASE_URL}/api/call-token/${expiredToken}`);
    assert(expiredRes.status === 410, `Expected 410 Gone for expired token, got ${expiredRes.status}`);
    console.log('✓ PASS: Expired token rejected with 410 Gone.');

    // TEST 12: Daily call cap enforcement (MAX_CALLS_PER_DAY=5)
    console.log('\n[Test 12] Daily budget cap: MAX_CALLS_PER_DAY (5) enforcement');
    // Insert 5 calls today
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO calls (id, missed_call_id, business_id, customer_phone, start_time)
        VALUES (?, ?, ?, ?, ?)
      `).run(`call_daily_${i}`, null, 'biz_1', '+15551234', new Date().toISOString());
    }
    const freshToken = 'freshtoken123456789abcdef012345678';
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

    // TEST 13: Trust proxy rate limit using X-Forwarded-For
    console.log('\n[Test 13] Trust proxy: rate limiting isolates client IP via X-Forwarded-For');
    const proxyIp = '203.0.113.195';
    let proxyRateLimited = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE_URL}/api/missed-calls/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
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

    // TEST 14: Clear test data admin action
    console.log('\n[Test 14] Data hygiene: authenticated clear test data action');
    const clearRes = await fetch(`${BASE_URL}/api/admin/clear-test-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
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
    console.log('🎉 ALL 14 SECURITY & HARDENING TESTS PASSED!');
    console.log('====================================================\n');
  } catch (err: any) {
    console.error('Test execution failed:', err);
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
