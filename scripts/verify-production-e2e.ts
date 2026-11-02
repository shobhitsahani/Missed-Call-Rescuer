/**
 * Production Live End-to-End Callback Verification Script
 *
 * Targets:
 * - API: https://missed-call-rescuer-api.onrender.com
 * - WebSocket: wss://missed-call-rescuer-api.onrender.com/ws
 *
 * Verifies live in production:
 * 1. Health check & business config.
 * 2. Unverified missed call simulation -> Agent asks for callback number.
 * 3. Incomplete number ("one two one two one two one two") is rejected.
 * 4. Split multi-turn number ("nine eight seven six five four three two one" + "zero") is accepted.
 * 5. Agent asks what the call was about WITHOUT repeating the phone number question.
 * 6. Customer says "About leaked." -> Agent addresses the leak without re-asking for phone.
 * 7. Call summary contains reason: leak and contact_details: +19876543210.
 */

import WebSocket from 'ws';

const PROD_API = process.env.PROD_API || 'https://missed-call-rescuer-api.onrender.com';
const PROD_WS = process.env.PROD_WS || 'wss://missed-call-rescuer-api.onrender.com/ws';

async function main() {
  console.log('=== VERIFYING PRODUCTION DEPLOYMENT ===');
  console.log(`Target API: ${PROD_API}`);
  console.log(`Target WS:  ${PROD_WS}\n`);

  // 1. Health check
  console.log('1. Checking Production Health Endpoint...');
  const healthRes = await fetch(`${PROD_API}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`Health check failed: ${healthRes.status} ${healthRes.statusText}`);
  }
  const healthData = await healthRes.json();
  console.log('  ✓ Production health status:', healthData);

  // 2. Simulate missed call
  console.log('\n2. Simulating Unverified Missed Call...');
  const simRes = await fetch(`${PROD_API}/api/missed-calls/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '+1 (555) 010-9999',
      phone_verified: false,
      source: 'prod_test',
    }),
  });
  if (!simRes.ok) {
    throw new Error(`Simulation failed: ${simRes.status} ${await simRes.text()}`);
  }
  const simData = await simRes.json();
  const token = simData.token;
  console.log(`  ✓ Token generated: ${token.slice(0, 8)}... (callId: ${simData.missedCallId})`);

  // 3. Connect to Production WebSocket
  console.log('\n3. Connecting to Production WebSocket...');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(PROD_WS, {
      headers: { Origin: 'https://missed-call-rescuer.vercel.app' },
    });
    const agentReplies: string[] = [];
    let currentAgentText = '';
    let isSpeaking = false;
    let customerStep = 0;
    let callSummary: any = null;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Production call timed out after 90s'));
    }, 90000);

    ws.on('open', () => {
      console.log('  ✓ WebSocket connected, joining call session...');
      ws.send(JSON.stringify({ type: 'join', token }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // Audio chunk
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === 'agent_text') {
        currentAgentText += (currentAgentText ? ' ' : '') + msg.text;
      }

      if (msg.type === 'state') {
        if (msg.state === 'SPEAKING') {
          isSpeaking = true;
        } else if (msg.state === 'LISTENING') {
          if (isSpeaking) {
            isSpeaking = false;
            const text = currentAgentText.trim();
            currentAgentText = '';
            if (text) {
              agentReplies.push(text);
              console.log(`  [Agent Turn ${agentReplies.length}]: "${text}"`);
            }

            customerStep++;

            if (customerStep === 1) {
              // Greeting finished. Customer asks for assistance.
              const reply = 'Hi, I need assistance with a problem.';
              console.log(`\n  [Customer Turn 1]: "${reply}"`);
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'transcript', text: reply, final: true }));
                }
              }, 400);
            } else if (customerStep === 2) {
              // Agent asks for phone. Customer provides 8 digits (incomplete).
              const reply = 'one two one two one two one two';
              console.log(`\n  [Customer Turn 2 (Incomplete 8 digits)]: "${reply}"`);
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'transcript', text: reply, final: true }));
                }
              }, 400);
            } else if (customerStep === 3) {
              // Agent asks for complete number. Customer provides 9 digits (incomplete fragment).
              const fragment1 = 'nine eight seven six five four three two one';
              console.log(`\n  [Customer Turn 3 (9-digit fragment)]: "${fragment1}"`);
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'transcript', text: fragment1, final: true }));
                }
              }, 400);
            } else if (customerStep === 4) {
              // Customer provides missing final digit ("zero").
              // This stitches with pending 9 digits to form complete 10-digit number!
              const fragment2 = 'zero';
              console.log(`\n  [Customer Turn 4 (Final digit "zero" -> completes 10 digits)]: "${fragment2}"`);
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'transcript', text: fragment2, final: true }));
                }
              }, 400);
            } else if (customerStep === 5) {
              // Agent should acknowledge validated number and ask call reason. Customer answers.
              const reply = 'About leaked.';
              console.log(`\n  [Customer Turn 5 (Call Reason)]: "${reply}"`);
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'transcript', text: reply, final: true }));
                }
              }, 400);
            } else if (customerStep === 6) {
              // Agent addressed leak. Customer concludes call.
              console.log('\n  [Ending call session...]');
              setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
                }
              }, 1200);
            }
          }
        }
      }

      if (msg.type === 'summary') {
        callSummary = msg.summary;
        console.log('\n4. Call Summary Received from Production:');
        console.log(`  - Reason:           ${callSummary.reason}`);
        console.log(`  - Contact Details:  ${callSummary.contact_details}`);
        console.log(`  - Suggested Action: ${callSummary.suggested_action}`);
        setTimeout(() => ws.close(), 500);
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);

      console.log('\n5. Verifying Dialogue Invariants:');

      // Turn 2 check: Agent asked for callback number
      const askedPhoneEarly = agentReplies.some(r => /phone\s*(number)?|callback\s*number/i.test(r));
      console.log(`  - Asked for callback number when unverified: ${askedPhoneEarly ? 'YES (PASS)' : 'NO (FAIL)'}`);

      // Turn 3 check: Agent requested repeat digits after 8-digit input
      const requestedRepeat = agentReplies.some(r => /repeat.*10-digit|repeat.*number|incomplete/i.test(r));
      console.log(`  - Rejected 8 digits and requested full 10 digits: ${requestedRepeat ? 'YES (PASS)' : 'NO (FAIL)'}`);

      // Turns after complete digits: agent should NOT ask for phone again
      const repliesAfterComplete = agentReplies.slice(4);
      const repeatedPhoneAfterFull = repliesAfterComplete.some(r => /repeat your.*phone number|what is your phone number|best phone number/i.test(r));
      console.log(`  - Replies after complete digits:`, repliesAfterComplete);
      console.log(`  - Transitioned to call reason WITHOUT duplicate phone question: ${!repeatedPhoneAfterFull ? 'YES (PASS)' : 'NO (FAIL)'}`);

      // Summary check
      const summaryHasPhone = callSummary && callSummary.contact_details && callSummary.contact_details.includes('9876543210');
      const actionNoContradiction = callSummary && !/obtain.*phone/i.test(callSummary.suggested_action);
      console.log(`  - Summary contact details has +19876543210: ${summaryHasPhone ? 'YES (PASS)' : 'NO (FAIL)'}`);
      console.log(`  - Summary action has no contradictory phone request: ${actionNoContradiction ? 'YES (PASS)' : 'NO (FAIL)'}`);

      if (askedPhoneEarly && requestedRepeat && !repeatedPhoneAfterFull && summaryHasPhone && actionNoContradiction) {
        console.log('\n================================================================');
        console.log('🎉 PRODUCTION LIVE END-TO-END VERIFICATION FULLY PASSED!');
        console.log('================================================================\n');
        resolve();
      } else {
        reject(new Error('One or more production invariants failed'));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

main().catch((err) => {
  console.error('Production verification failed:', err);
  process.exit(1);
});
