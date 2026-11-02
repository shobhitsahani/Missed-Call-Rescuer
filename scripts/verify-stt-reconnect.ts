import dotenv from 'dotenv';
dotenv.config({ override: true });
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:4000';
const WS_BASE = 'ws://localhost:4000/ws';

async function simulateCall(): Promise<{ token: string; missedCallId: string }> {
  const res = await fetch(`${API_BASE}/api/missed-calls/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+1 (555) 012-9988' }),
  });
  const data = await res.json();
  return { token: data.token, missedCallId: data.missedCallId };
}

async function forceDisconnectSTT(missedCallId?: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/test/force-stt-disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ missedCallId }),
  });
  const data = await res.json();
  console.log('Force disconnect endpoint response:', data);
  return data.ok;
}

async function streamPcmAudio(ws: WebSocket, pcm: Buffer, chunkSize = 1600, intervalMs = 50) {
  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    if (ws.readyState !== WebSocket.OPEN) break;
    let chunk = pcm.subarray(offset, Math.min(offset + chunkSize, pcm.length));
    if (chunk.length < 640) {
      const padded = Buffer.alloc(640);
      chunk.copy(padded);
      chunk = padded;
    }
    ws.send(chunk);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const silence = Buffer.alloc(chunkSize);
  for (let i = 0; i < 30; i++) {
    if (ws.readyState !== WebSocket.OPEN) break;
    ws.send(silence);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function testSttMidCallDisconnect(): Promise<void> {
  console.log('====================================================');
  console.log('TEST: STT Mid-Call Disconnect and Reconnect Resilience');
  console.log('====================================================');

  const turn1Pcm = fs.readFileSync(path.join(__dirname, 'fixtures', 'turn1.pcm'));
  const turn2Pcm = fs.readFileSync(path.join(__dirname, 'fixtures', 'turn2.pcm'));

  const { token, missedCallId } = await simulateCall();
  const ws = new WebSocket(WS_BASE);

  return new Promise<void>((resolve, reject) => {
    let greetingDone = false;
    let turn1Sent = false;
    let turn1Done = false;
    let disconnectTriggered = false;
    let reconnectStateReceived = false;
    let turn2Sent = false;
    let turn2TranscriptReceived = false;
    let turn2Done = false;

    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('Mid-call STT disconnect test timed out after 35s'));
    }, 35000);

    function cleanup() {
      clearTimeout(timeout);
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', token }));
    });

    ws.on('message', async (data, isBinary) => {
      if (isBinary) return;

      const msg = JSON.parse(data.toString());
      console.log('CLIENT MSG RECV:', msg.type, msg.state || '');

      if (msg.type === 'state') {
        if (msg.state === 'RECONNECTING') {
          console.log('[Client State]: RECONNECTING (status indicator triggered cleanly)');
          reconnectStateReceived = true;
        } else if (msg.state === 'LISTENING') {
          if (!greetingDone) {
            greetingDone = true;
            console.log('1. Greeting finished. Streaming Turn 1 audio...');
            turn1Sent = true;
            await streamPcmAudio(ws, turn1Pcm);
          } else if (turn1Done && !disconnectTriggered) {
            disconnectTriggered = true;
            console.log('3. Forcing upstream STT disconnect mid-call...');
            await forceDisconnectSTT(missedCallId);
          } else if (reconnectStateReceived && !turn2Sent) {
            console.log('4. STT reconnected and back in LISTENING! Streaming Turn 2 audio...');
            turn2Sent = true;
            await streamPcmAudio(ws, turn2Pcm);
          } else if (turn2TranscriptReceived && !turn2Done) {
            turn2Done = true;
            console.log('5. Turn 2 completed successfully after reconnect! Ending call cleanly...');
            ws.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
          }
        }
      } else if (msg.type === 'customer_transcript') {
        console.log(`[STT Transcript]: "${msg.text}"`);
        if (turn1Sent && !turn1Done) {
          console.log('2. Turn 1 transcribed successfully!');
        } else if (turn2Sent) {
          console.log('4. Turn 2 transcribed successfully after STT disconnect & reconnect!');
          turn2TranscriptReceived = true;
        }
      } else if (msg.type === 'agent_text') {
        if (greetingDone && !turn1Done) {
          turn1Done = true;
          console.log(`Agent reply (Turn 1): "${msg.text}"`);
        } else if (turn2Sent) {
          console.log(`Agent reply (Turn 2): "${msg.text}"`);
        }
      } else if (msg.type === 'summary') {
        console.log('6. Summary received:', msg.summary?.short_summary);
        cleanup();
        ws.close();

        if (turn1Done && reconnectStateReceived && turn2TranscriptReceived) {
          console.log('\n====================================================');
          console.log('STT DISCONNECT RESILIENCE TEST: PASSED');
          console.log('====================================================\n');
          resolve();
        } else {
          reject(
            new Error(
              `Test failed assertions: turn1Done=${turn1Done}, reconnectStateReceived=${reconnectStateReceived}, turn2TranscriptReceived=${turn2TranscriptReceived}`
            )
          );
        }
      } else if (msg.type === 'error') {
        console.error('WS Error:', msg.message);
        cleanup();
        ws.close();
        reject(new Error(`Unexpected WS error: ${msg.message}`));
      }
    });

    ws.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

testSttMidCallDisconnect()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });
