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
async function streamPcmAudio(
  ws: WebSocket,
  pcm: Buffer,
  chunkSize = 1600,
  intervalMs = 50,
  shouldStop?: () => boolean
) {
  for (let offset = 0; offset < pcm.length; offset += chunkSize) {
    if (ws.readyState !== WebSocket.OPEN) break;
    let chunk = pcm.subarray(offset, Math.min(offset + chunkSize, pcm.length));
    if (chunk.length < 640) {
      // pad with silence to at least 20ms (640 bytes) to respect AssemblyAI min frame size
      const padded = Buffer.alloc(640);
      chunk.copy(padded);
      chunk = padded;
    }
    ws.send(chunk);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Send silence chunks so AssemblyAI STT hits max_turn_silence (1000ms) reliably
  // Max 40 chunks (2000ms), stops early once turn is finalized
  const silence = Buffer.alloc(chunkSize);
  for (let i = 0; i < 40; i++) {
    if (ws.readyState !== WebSocket.OPEN) break;
    if (shouldStop && shouldStop()) break;
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
    let turnFinalReceived = false;
    let activeMetric: Partial<TurnMetric> | null = null;
    let currentAgentText = '';
    let greetingDone = false;
    let turnTimer: NodeJS.Timeout | null = null;

    const globalTimeout = setTimeout(() => {
      cleanup();
      try { ws.close(); } catch {}
      reject(new Error('run5Turns test timed out after 180s'));
    }, 180000);

    function cleanup() {
      clearTimeout(globalTimeout);
      if (turnTimer) {
        clearTimeout(turnTimer);
        turnTimer = null;
      }
    }

    function resetTurnTimer() {
      if (turnTimer) clearTimeout(turnTimer);
      turnTimer = setTimeout(() => {
        cleanup();
        try { ws.close(); } catch {}
        reject(new Error(`Turn ${currentTurnIndex + 1} timed out waiting for agent response after 45s`));
      }, 45000);
    }

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
        turnFinalReceived = true;
        resetTurnTimer();
        console.log(`\n  [STT Final Turn]: "${msg.text}"`);
      } else if (msg.type === 'state') {
        if (msg.state === 'LISTENING') {
          if (!greetingDone) {
            greetingDone = true;
            console.log('Greeting completed. Starting customer audio streaming...');
            sendNextTurn();
          } else if (turnInProgress && currentAgentText.trim().length > 0) {
            turnInProgress = false;
            if (turnTimer) {
              clearTimeout(turnTimer);
              turnTimer = null;
            }
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
              setTimeout(sendNextTurn, 1000);
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
        cleanup();
        ws.close();
        resolve(turnMetrics);
      } else if (msg.type === 'error') {
        console.error('WS error message:', msg.message);
      }
    });

    ws.on('error', (err) => {
      cleanup();
      reject(err);
    });

    async function sendNextTurn() {
      currentTurnIndex++;
      turnInProgress = true;
      turnFinalReceived = false;
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
      resetTurnTimer();
      const p = prompts[currentTurnIndex];
      const audio = fixtures[p.name];
      console.log(`\nStreaming Audio (Turn ${currentTurnIndex + 1}): "${p.text}"`);
      await streamPcmAudio(ws, audio, 1600, 50, () => turnFinalReceived);
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
    let questionSent = false;
    let agentAudioStarted = false;
    let barged = false;
    let stopAudioReceived = false;
    let followUpSent = false;
    let audioFramesBetweenStopAndFollowup = 0;
    let followUpDone = false;

    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('testBargeIn timed out after 45s'));
    }, 45000);

    function cleanup() {
      clearTimeout(timeout);
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', missedCallId }));
    });

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        if (stopAudioReceived && !followUpSent) {
          audioFramesBetweenStopAndFollowup++;
        } else if (questionSent && !barged) {
          agentAudioStarted = true;
          barged = true;
          console.log('Agent speech audio chunk arrived after question! Streaming barge-in audio immediately...');
          streamPcmAudio(ws, bargeInPcm, 1600, 20).catch(console.error);
        }
        return;
      }

      const msg = JSON.parse(data.toString());
      console.log(`  [Barge-in test received]: type=${msg.type}${msg.state ? ' state=' + msg.state : ''}${msg.text ? ' text="' + msg.text.slice(0, 50) + '..."' : ''}`);

      if (msg.type === 'partial' && msg.text) {
        console.log(`  [Barge-in partial STT]: "${msg.text}"`);
      } else if (msg.type === 'state' && msg.state === 'LISTENING') {
        if (!greetingDone) {
          greetingDone = true;
          questionSent = true;
          console.log('Greeting completed. Sending question to trigger agent speech...');
          // Trigger a long explanation
          ws.send(JSON.stringify({ type: 'transcript', final: true, text: 'Can you tell me all the plumbing services you provide and describe each in detail?' }));
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
        if (agentAudioStarted) {
          stopAudioReceived = true;
        } else {
          console.log('Note: stop_audio arrived before agent turn audio started');
        }
      } else if (msg.type === 'agent_text' && followUpSent) {
        console.log(`Follow-up agent response received: "${msg.text}"`);
      } else if (msg.type === 'summary') {
        console.log('Call ended cleanly after barge-in test.');
        cleanup();
        ws.close();
        resolve(stopAudioReceived && audioFramesBetweenStopAndFollowup === 0 && followUpDone);
      }
    });

    ws.on('error', (err) => {
      cleanup();
      reject(err);
    });
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
    let optOutFinalReceived = false;
    let optOutAckReceived = false;

    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('testOptOut timed out after 45s'));
    }, 45000);

    function cleanup() {
      clearTimeout(timeout);
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', missedCallId }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;

      const msg = JSON.parse(data.toString());

      if (msg.type === 'partial' && msg.text) {
        process.stdout.write(`\r  [Opt-out partial]: "${msg.text}"`);
      } else if (msg.type === 'customer_transcript') {
        optOutFinalReceived = true;
        console.log(`\n  [Opt-out final STT]: "${msg.text}"`);
      } else if (msg.type === 'state' && msg.state === 'LISTENING') {
        if (!greetingDone) {
          greetingDone = true;
          console.log('Greeting completed. Streaming opt-out audio: "Please stop calling me and remove my number."');
          streamPcmAudio(ws, optOutPcm, 1600, 50, () => optOutFinalReceived);
        }
      } else if (msg.type === 'agent_text') {
        console.log(`Agent reply: "${msg.text}"`);
        if (msg.text.toLowerCase().includes('stop calling') || msg.text.toLowerCase().includes('understand')) {
          optOutAckReceived = true;
        }
      } else if (msg.type === 'summary') {
        console.log('Call completed with summary.');
        cleanup();
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

    ws.on('error', (err) => {
      cleanup();
      reject(err);
    });
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
    console.log('\nWaiting 3s for session teardown before barge-in test...');
    await new Promise((r) => setTimeout(r, 3000));

    const bargeInSuccess = await testBargeIn(fixtures);
    console.log('\nWaiting 3s for session teardown before opt-out test...');
    await new Promise((r) => setTimeout(r, 3000));

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
