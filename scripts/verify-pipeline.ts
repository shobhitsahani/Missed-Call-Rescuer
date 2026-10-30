import dotenv from 'dotenv';
dotenv.config({ override: true });
import WebSocket from 'ws';

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
  audioFrames: number;
  audioBytes: number;
  agentText: string;
}

async function run5Turns(): Promise<TurnMetric[]> {
  console.log('\n=============================================');
  console.log('TEST 1: Running 5 normal conversation turns');
  console.log('=============================================');

  const missedCallId = await simulateCall();
  const ws = new WebSocket(WS_BASE);

  const turnMetrics: TurnMetric[] = [];
  const prompts = [
    'Hi, I have a leaking pipe under my sink.',
    'Yes, it is dripping pretty fast onto the cabinet floor.',
    'Could someone come by tomorrow morning around 9am?',
    'My number is 555-0199 and my name is Alex.',
    'Thank you, I appreciate it. Goodbye.',
  ];

  return new Promise<TurnMetric[]>((resolve, reject) => {
    let currentState = 'IDLE';
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

      if (msg.type === 'state') {
        currentState = msg.state;
        if (msg.state === 'LISTENING') {
          if (!greetingDone) {
            greetingDone = true;
            console.log('Greeting completed. Starting customer turns...');
            sendNextTurn();
          } else if (turnInProgress) {
            turnInProgress = false;
            if (activeMetric) {
              activeMetric.agentText = currentAgentText;
              turnMetrics.push(activeMetric as TurnMetric);
              const wordCount = currentAgentText.trim().split(/\s+/).filter(Boolean).length;
              console.log(`[Turn ${currentTurnIndex + 1} Done]`);
              console.log(`  Agent: "${currentAgentText}" (${wordCount} words)`);
              console.log(`  Metrics -> Total: ${activeMetric.totalMs} ms | LLM TTFT: ${activeMetric.llmFirstTokenMs} ms | TTS TTFA: ${activeMetric.ttsFirstAudioMs} ms`);
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
        }
      } else if (msg.type === 'summary') {
        console.log('Summary received:', msg.summary.short_summary);
        ws.close();
        resolve(turnMetrics);
      } else if (msg.type === 'error') {
        console.error('WS error message:', msg.message);
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    function sendNextTurn() {
      currentTurnIndex++;
      turnInProgress = true;
      currentAgentText = '';
      activeMetric = {
        totalMs: 0,
        llmFirstTokenMs: null,
        ttsFirstAudioMs: null,
        audioFrames: 0,
        audioBytes: 0,
        agentText: '',
      };
      const text = prompts[currentTurnIndex];
      console.log(`\nCustomer (Turn ${currentTurnIndex + 1}): "${text}"`);
      ws.send(JSON.stringify({ type: 'transcript', final: true, text }));
    }
  });
}

async function testBargeIn(): Promise<boolean> {
  console.log('\n=============================================');
  console.log('TEST 2: Barge-in test');
  console.log('=============================================');

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

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (stopAudioReceived && !followUpSent) {
          audioFramesBetweenStopAndFollowup++;
        } else if (greetingDone && !barged) {
          console.log('First audio chunk arrived during turn! Triggering barge-in immediately...');
          barged = true;
          ws.send(JSON.stringify({ type: 'barge_in' }));
        }
        return;
      }

      const msg = JSON.parse(data.toString());

      if (msg.type === 'state' && msg.state === 'LISTENING') {
        if (!greetingDone) {
          greetingDone = true;
          console.log('Greeting completed. Sending utterance to interrupt...');
          ws.send(JSON.stringify({ type: 'transcript', final: true, text: 'Can you tell me all the plumbing services you provide?' }));
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

async function testOptOut(): Promise<boolean> {
  console.log('\n=============================================');
  console.log('TEST 3: Opt-out test');
  console.log('=============================================');

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

      if (msg.type === 'state' && msg.state === 'LISTENING') {
        if (!greetingDone) {
          greetingDone = true;
          console.log('Greeting completed. Sending opt-out phrase: "Please stop calling me."');
          ws.send(JSON.stringify({ type: 'transcript', final: true, text: 'Please stop calling me and remove my number.' }));
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
    const turns = await run5Turns();
    const bargeInSuccess = await testBargeIn();
    const optOutSuccess = await testOptOut();

    console.log('\n=============================================');
    console.log('FINAL VERIFICATION REPORT');
    console.log('=============================================');
    console.log('5 Normal Turns Latencies:');
    turns.forEach((t, i) => {
      console.log(`  Turn ${i + 1}: Total = ${t.totalMs} ms (LLM TTFT = ${t.llmFirstTokenMs} ms, TTS TTFA = ${t.ttsFirstAudioMs} ms)`);
    });

    const totals = turns.map(t => t.totalMs);
    const llms = turns.map(t => t.llmFirstTokenMs!).filter(n => typeof n === 'number');
    const ttss = turns.map(t => t.ttsFirstAudioMs!).filter(n => typeof n === 'number');

    const avgTotal = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
    const worstTotal = Math.max(...totals);

    const avgLlm = Math.round(llms.reduce((a, b) => a + b, 0) / llms.length);
    const worstLlm = Math.max(...llms);

    const avgTts = Math.round(ttss.reduce((a, b) => a + b, 0) / ttss.length);
    const worstTts = Math.max(...ttss);

    console.log('\nSummary Numbers:');
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
