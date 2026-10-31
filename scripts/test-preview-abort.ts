import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

const TEST_PORT = 4099;
const SERVER_URL = `http://localhost:${TEST_PORT}`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxWaitMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${SERVER_URL}/api/business/voices`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(250);
  }
  throw new Error(`Server failed to start on port ${TEST_PORT} within ${maxWaitMs}ms`);
}

function sendAbortedRequest(index: number, voiceId: string): Promise<void> {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ voiceId });
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/business/voice-preview',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      // Abort immediately upon getting response or first chunk
      res.on('data', () => {
        req.destroy();
        resolve();
      });
      // Fallback in case no data emitted before close
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });

    req.on('error', () => {
      // Expected error on destroy
      resolve();
    });

    req.write(postData);
    req.end();
    // Destroy after a short delay to simulate client navigation / user clicking stop
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 150);
  });
}

function sendNormalRequest(voiceId: string, timeoutMs = 5000): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ voiceId });
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/business/voice-preview',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Normal request timed out after ${timeoutMs}ms (socket starvation)`));
    });

    req.on('error', (err) => reject(err));

    req.write(postData);
    req.end();
  });
}

async function runRegressionTest() {
  console.log(`--- Starting test server on port ${TEST_PORT} ---`);
  const tsxCli = path.join(__dirname, '../node_modules/tsx/dist/cli.mjs');
  const serverScript = path.join(__dirname, '../server/index.ts');

  const child: ChildProcess = spawn(process.execPath, [tsxCli, serverScript], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d) => {
    process.stdout.write(`[SERVER OUT] ${d}`);
  });
  child.stderr?.on('data', (d) => {
    process.stdout.write(`[SERVER ERR] ${d}`);
  });

  const cleanup = () => {
    try {
      child.kill('SIGTERM');
    } catch {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  try {
    await waitForServer();
    console.log('✓ Server listening and ready for requests.');

    console.log('--- Firing 10 aborted preview requests ---');
    const ABORT_VOICES = [
      'aai-jane', 'aai-sara', 'aai-anna', 'aai-alba', 'aai-eve',
      'aai-mary', 'aai-vera', 'aai-jean', 'aai-michael', 'aai-paul'
    ];
    for (let i = 0; i < 10; i++) {
      const voice = ABORT_VOICES[i];
      process.stdout.write(`  Aborting request ${i + 1}/10 (${voice})... `);
      await sendAbortedRequest(i + 1, voice);
      console.log('aborted.');
      await sleep(100);
    }
    console.log('✓ 10 aborted requests fired.');
    await sleep(1500);

    console.log('--- Sending normal preview request (asserting success within 5s) ---');
    const startNormal = Date.now();
    // Test with aai-george to ensure uncached upstream synthesis succeeds without deadlock
    const result = await sendNormalRequest('aai-george', 5000);
    const duration = Date.now() - startNormal;
    console.log(`✓ Normal request completed in ${duration}ms with status HTTP ${result.statusCode}.`);

    assert(result.statusCode === 200, `Expected HTTP 200, got ${result.statusCode}`);
    assert(result.headers['content-type'] === 'audio/wav', `Expected audio/wav, got ${result.headers['content-type']}`);
    assert(result.buffer.length > 44, `Buffer length must exceed 44 bytes, got ${result.buffer.length}`);

    // Verify valid WAV headers
    assert(result.buffer.subarray(0, 4).toString('ascii') === 'RIFF', 'Valid RIFF header');
    assert(result.buffer.subarray(8, 12).toString('ascii') === 'WAVE', 'Valid WAVE header');
    assert(result.buffer.subarray(12, 16).toString('ascii') === 'fmt ', 'Valid fmt subchunk');

    console.log('✓ Received valid WAV audio file with length', result.buffer.length, 'bytes.');
    console.log('✓ Abort regression test PASSED: socket pool released all aborted sockets without deadlock.');
  } finally {
    cleanup();
  }
}

runRegressionTest().catch((err) => {
  console.error('FAILED with error:', err.message);
  process.exit(1);
});
