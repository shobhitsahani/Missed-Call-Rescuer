import dotenv from 'dotenv';
dotenv.config({ override: true });
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { TtsClient } from '../server/tts';

const API_BASE = 'http://localhost:4000';
const WS_BASE = 'ws://localhost:4000/ws';

async function simulateCall(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/missed-calls/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+1 (555) 012-3456' }),
  });
  const data = await res.json();
  return data.missedCallId;
}

interface TurnMetric {
  totalMs: number;
  llmFirstTokenMs: number | null;
  ttsFirstAudioMs: number | null;
  turnDetectionMs?: number | null;
  audioFrames: number;
  audioBytes: number;
  agentText: string;
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

// Prepare cached audio fixtures using a single TTS session
async function prepareFixtures(items: { name: string; text: string }[]): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {};
  const needed = items.filter(it => !fs.existsSync(path.join(FIXTURES_DIR, `${it.name}.pcm`)));

  if (needed.length > 0) {
    console.log(`Synthesizing ${needed.length} audio fixture(s) via single AssemblyAI TTS session...`);
    const tts = new TtsClient({
      apiKey: process.env.ASSEMBLYAI_API_KEY!,
      voiceId: 'aai-jane',
      sampleRate: 16000,
      encoding: 'pcm_s16le',
    });
    await tts.connectWithRetry();

    for (const item of needed) {
      const chunks: Buffer[] = [];
      for await (const chunk of tts.speak(item.text)) {
        chunks.push(Buffer.from(chunk));
      }
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(path.join(FIXTURES_DIR, `${item.name}.pcm`), buf);
      console.log(`  Saved fixture ${item.name}.pcm (${buf.length} bytes, ~${Math.round(buf.length / 32)} ms)`);
    }

    await tts.close();
  }

  for (const item of items) {
    result[item.name] = fs.readFileSync(path.join(FIXTURES_DIR, `${item.name}.pcm`));
  }
  return result;
}

// Stream PCM audio in 50ms (1600 byte) frames, followed by silence for turn detection
async function streamPcmAudio(ws: WebSocket, pcm: Buffer, chunkSize = 1600, intervalMs = 50) {
  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    if (ws.readyState !== WebSocket.OPEN) break;
    const chunk = pcm.subarray(offset, Math.min(offset + chunkSize, pcm.length));
    ws.send(chunk);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Send 30 chunks (1500ms) of silence so AssemblyAI STT hits max_turn_silence (1000ms) reliably
  const silence = Buffer.alloc(chunkSize);
  for (let i = 0; i < 30; i++) {
    if (ws.readyState !== WebSocket.OPEN) break;
    ws.send(silence);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function run5Turns(fixtures: Record<string, Buffer>): Promise<TurnMetric[]> {
  console.log('\n=============================================');
  console.log('TEST 1: Running 5 normal conversation turns via AssemblyAI STT');
  console.log('=============================================');

  const prompts = [
    { name: 'turn1', text: 'Hi, I have a leaking pipe under my sink.' },
    { name: 'turn2', text: 'Yes, it is dripping pretty fast onto the cabinet floor.' },
    { name: 'turn3', text: 'Could someone come by tomorrow morning around 9am?' },
    { name: 'turn4', text: 'My number is 555-0199 and my name is Alex.' },
    { name: 'turn5', text: 'Thank you, I appreciate it. Goodbye.' },
  ];

  const missedCallId = await simulateCall();
  const ws = new WebSocket(WS_BASE);

  const turnMetrics: TurnMetric[] = [];

  return new Promise<TurnMetric[]>((resolve, reject) => {
    let currentTurnIndex = -1;
    let turnInProgress = false;
    let activeMetric: Partial<TurnMetric> | null = null;
    let currentAgentText = '';
    let greetingDone = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', missedCallId }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (activeMetric) {
          activeMetric.audioFrames = (activeMetric.audioFrames || 0) + 1;
          activeMetric.audioBytes = (activeMetric.audioBytes || 0) + (data as Buffer).length;
        }
        return;
      }

      const msg = JSON.parse(data.toString());

      if (msg.type === 'partial' && msg.text) {
        process.stdout.write(`\r  [STT Live Partial]: "${msg.text}"`);
      } else if (msg.type === 'customer_transcript') {
        console.log(`\n  [STT Final Turn]: "${msg.text}"`);
      } else if (msg.type === 'state') {
        if (msg.state === 'LISTENING') {
          if (!greetingDone) {
            greetingDone = true;
            console.log('Greeting completed. Starting customer audio streaming...');
            sendNextTurn();
          } else if (turnInProgress) {
            turnInProgress = false;
            if (activeMetric) {
              activeMetric.agentText = currentAgentText;
              turnMetrics.push(activeMetric as TurnMetric);
              const wordCount = currentAgentText.trim().split(/\s+/).filter(Boolean).length;
              console.log(`[Turn ${currentTurnIndex + 1} Done]`);
              console.log(`  Agent: "${currentAgentText}" (${wordCount} words)`);
              console.log(`  Metrics -> Total: ${activeMetric.totalMs} ms | Turn Detection: ${activeMetric.turnDetectionMs ?? '—'} ms | LLM TTFT: ${activeMetric.llmFirstTokenMs} ms | TTS TTFA: ${activeMetric.ttsFirstAudioMs} ms`);
              console.log(`  Audio   -> ${activeMetric.audioFrames} frames, ${activeMetric.audioBytes} bytes`);
            }
            if (currentTurnIndex + 1 < prompts.length) {
              setTimeout(sendNextTurn, 600);
            } else {
              console.log('All 5 turns completed. Ending call...');
              ws.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
            }
          }
        }
      } else if (msg.type === 'agent_text') {
        currentAgentText += (currentAgentText ? ' ' : '') + msg.text;
      } else if (msg.type === 'metrics') {
        if (activeMetric) {
          activeMetric.totalMs = msg.totalMs;
          activeMetric.llmFirstTokenMs = msg.llmFirstTokenMs;
          activeMetric.ttsFirstAudioMs = msg.ttsFirstAudioMs;
          activeMetric.turnDetectionMs = msg.turnDetectionMs ?? null;
        }
      } else if (msg.type === 'summary') {
        console.log('Summary received:', msg.summary?.short_summary);
        ws.close();
        resolve(turnMetrics);
      } else if (msg.type === 'error') {
        console.error('WS error message:', msg.message);
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    async function sendNextTurn() {
      currentTurnIndex++;
      turnInProgress = true;
      currentAgentText = '';
      activeMetric = {
        totalMs: 0,
        llmFirstTokenMs: null,
        ttsFirstAudioMs: null,
        turnDetectionMs: null,
        audioFrames: 0,
        audioBytes: 0,
        agentText: '',
      };
      const p = prompts[currentTurnIndex];
      const audio = fixtures[p.name];
      console.log(`\nStreaming Audio (Turn ${currentTurnIndex + 1}): "${p.text}"`);
      await streamPcmAudio(ws, audio);
    }
  });
}

async function testBargeIn(fixtures: Record<string, Buffer>): Promise<boolean> {
  console.log('\n=============================================');
  console.log('TEST 2: Barge-in test via AssemblyAI STT');
  console.log('=============================================');

  const bargeInPcm = fixtures['barge_in'];
  const missedCallId = await simulateCall();
  const ws = new WebSocket(WS_BASE);

  return new Promise<boolean>((resolve, reject) => {
    let greetingDone = false;
    let barged = false;
    let stopAudioReceived = false;
    let followUpSent = false;
    let audioFramesBetweenStopAndFollowup = 0;
    let followUpDone = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', missedCallId }));
    });

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        if (stopAudioReceived && !followUpSent) {
          audioFramesBetweenStopAndFollowup++;
        } else if (greetingDone && !barged) {
          barged = true;
          console.log('First audio chunk arrived during turn! Waiting 450ms for guard and streaming barge-in...');
          setTimeout(() => {
            streamPcmAudio(ws, bargeInPcm, 1600, 30).catch(console.error);
          }, 450);
        }
        return;
      }

      const msg = JSON.parse(data.toString());

      if (msg.type === 'partial' && msg.text) {
        console.log(`  [Barge-in partial STT]: "${msg.text}"`);
      } else if (msg.type === 'state' && msg.state === 'LISTENING') {
        if (!greetingDone) {
          greetingDone = true;
          console.log('Greeting completed. Sending question to trigger agent speech...');
          // Trigger a long explanation
          ws.send(JSON.stringify({ type: 'transcript', final: true, text: 'Can you tell me all the plumbing services you provide in detail?' }));
        } else if (stopAudioReceived && !followUpSent) {
          followUpSent = true;
          console.log('Session back in LISTENING state after barge-in!');
          console.log('Audio frames leaked after stop_audio (before follow-up):', audioFramesBetweenStopAndFollowup);
          console.log('Sending follow-up after barge-in: "Just leak repair please."');
          ws.send(JSON.stringify({ type: 'transcript', final: true, text: 'Just leak repair please.' }));
        } else if (followUpSent && !followUpDone) {
          followUpDone = true;
          console.log('Follow-up turn completed cleanly. Ending call...');
          ws.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
        }
      } else if (msg.type === 'stop_audio') {
        console.log('Received { type: "stop_audio" } from server.');
        stopAudioReceived = true;
      } else if (msg.type === 'agent_text' && followUpSent) {
        console.log(`Follow-up agent response received: "${msg.text}"`);
      } else if (msg.type === 'summary') {
        console.log('Call ended cleanly after barge-in test.');
        ws.close();
        resolve(stopAudioReceived && audioFramesBetweenStopAndFollowup === 0 && followUpDone);
      }
    });

    ws.on('error', reject);
  });
}

async function testOptOut(fixtures: Record<string, Buffer>): Promise<boolean> {
  console.log('\n=============================================');
  console.log('TEST 3: Opt-out test via AssemblyAI STT');
  console.log('=============================================');

  const optOutPcm = fixtures['opt_out'];
  const missedCallId = await simulateCall();
  const ws = new WebSocket(WS_BASE);

  return new Promise<boolean>((resolve, reject) => {
    let greetingDone = false;
    let optOutAckReceived = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', missedCallId }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;

      const msg = JSON.parse(data.toString());

      if (msg.type === 'partial' && msg.text) {
        process.stdout.write(`\r  [Opt-out partial]: "${msg.text}"`);
      } else if (msg.type === 'customer_transcript') {
        console.log(`\n  [Opt-out final STT]: "${msg.text}"`);
      } else if (msg.type === 'state' && msg.state === 'LISTENING') {
        if (!greetingDone) {
          greetingDone = true;
          console.log('Greeting completed. Streaming opt-out audio: "Please stop calling me and remove my number."');
          streamPcmAudio(ws, optOutPcm);
        }
      } else if (msg.type === 'agent_text') {
        console.log(`Agent reply: "${msg.text}"`);
        if (msg.text.toLowerCase().includes('stop calling') || msg.text.toLowerCase().includes('understand')) {
          optOutAckReceived = true;
        }
      } else if (msg.type === 'summary') {
        console.log('Call completed with summary.');
        ws.close();
        // check DB status for this missed call
        setTimeout(async () => {
          const res = await fetch(`${API_BASE}/api/missed-calls`);
          const calls = await res.json();
          const mc = calls.find((c: any) => c.id === missedCallId);
          console.log(`Missed call DB status: ${mc?.status}`);
          resolve(optOutAckReceived && mc?.status === 'opted_out');
        }, 300);
      }
    });

    ws.on('error', reject);
  });
}

async function main() {
  try {
    const fixtureItems = [
      { name: 'turn1', text: 'Hi, I have a leaking pipe under my sink.' },
      { name: 'turn2', text: 'Yes, it is dripping pretty fast onto the cabinet floor.' },
      { name: 'turn3', text: 'Could someone come by tomorrow morning around 9am?' },
      { name: 'turn4', text: 'My number is 555-0199 and my name is Alex.' },
      { name: 'turn5', text: 'Thank you, I appreciate it. Goodbye.' },
      { name: 'barge_in', text: 'Wait, hold on, stop please.' },
      { name: 'opt_out', text: 'Please stop calling me and remove my number.' },
    ];

    const fixtures = await prepareFixtures(fixtureItems);

    const turns = await run5Turns(fixtures);
    const bargeInSuccess = await testBargeIn(fixtures);
    const optOutSuccess = await testOptOut(fixtures);

    console.log('\n=============================================');
    console.log('FINAL VERIFICATION REPORT');
    console.log('=============================================');
    console.log('5 Normal Turns Latencies:');
    turns.forEach((t, i) => {
      console.log(`  Turn ${i + 1}: Total = ${t.totalMs} ms (Turn Detection = ${t.turnDetectionMs ?? '—'} ms, LLM TTFT = ${t.llmFirstTokenMs} ms, TTS TTFA = ${t.ttsFirstAudioMs} ms)`);
    });

    const totals = turns.map(t => t.totalMs);
    const llms = turns.map(t => t.llmFirstTokenMs!).filter(n => typeof n === 'number');
    const ttss = turns.map(t => t.ttsFirstAudioMs!).filter(n => typeof n === 'number');
    const turnDets = turns.map(t => t.turnDetectionMs!).filter(n => typeof n === 'number');

    const avgTotal = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
    const worstTotal = Math.max(...totals);

    const avgLlm = Math.round(llms.reduce((a, b) => a + b, 0) / llms.length);
    const worstLlm = Math.max(...llms);

    const avgTts = Math.round(ttss.reduce((a, b) => a + b, 0) / ttss.length);
    const worstTts = Math.max(...ttss);

    const avgTurn = turnDets.length ? Math.round(turnDets.reduce((a, b) => a + b, 0) / turnDets.length) : null;
    const worstTurn = turnDets.length ? Math.max(...turnDets) : null;

    console.log('\nSummary Numbers:');
    console.log(`  turnDetectionMs -> Avg: ${avgTurn ?? '—'} ms, Worst: ${worstTurn ?? '—'} ms`);
    console.log(`  llmFirstTokenMs -> Avg: ${avgLlm} ms, Worst: ${worstLlm} ms`);
    console.log(`  ttsFirstAudioMs -> Avg: ${avgTts} ms, Worst: ${worstTts} ms`);
    console.log(`  totalMs         -> Avg: ${avgTotal} ms, Worst: ${worstTotal} ms`);
    console.log(`\nRegression Checks:`);
    console.log(`  Barge-in test: ${bargeInSuccess ? 'PASSED' : 'FAILED'}`);
    console.log(`  Opt-out test:  ${optOutSuccess ? 'PASSED' : 'FAILED'}`);
    console.log('=============================================\n');

  } catch (err: any) {
    console.error('Verification failed with error:', err);
    process.exit(1);
  }
}

main();
