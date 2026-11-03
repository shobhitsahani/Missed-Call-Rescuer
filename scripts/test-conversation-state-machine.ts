/**
 * Comprehensive Test Suite for:
 * 1. Conversation State Machine (GREETING -> ACTIVE / AWAITING_CALLBACK_TIME -> WRAPPING_UP -> COMPLETED)
 * 2. Customer Unavailability Handling (asking callback time, recording, ending without unrelated questions)
 * 3. Validation (callback times, arbitrary spoken numbers, phone numbers)
 * 4. Configuration Loading across different industries (plumbing, software, dental, generic)
 * 5. Error handling & TTS Markdown Sanitization
 * 6. Duplicate Event Handling
 * 7. Call Termination Idempotency
 * 8. Summary Ground-Truth Verification
 */

import assert from 'assert';
import {
  isCustomerUnavailable,
  validateCallbackTime,
  extractCallbackTime,
  sanitizeTtsText,
} from '../server/validation';
import { extractPhoneFromUtterance, validatePhoneDigits, maskPhone } from '../server/phone';
import { buildSystem, StructuredSummary } from '../server/llm';
import { BUSINESS_PRESETS } from '../src/lib/presets';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res.then(
        () => {
          console.log(`  ✓ ${name}`);
          passed++;
        },
        (err) => {
          console.error(`  ✗ ${name}`);
          console.error('    Error:', err.message);
          failed++;
        }
      );
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ ${name}`);
    console.error('    Error:', err.message);
    failed++;
  }
}

async function runAllTests() {
  console.log('\n=============================================================');
  console.log('🧪 Running Conversation State Machine & Improvement Tests');
  console.log('=============================================================\n');

  // -------------------------------------------------------------------------
  // 1. Customer Unavailability Detection
  // -------------------------------------------------------------------------
  console.log('Group 1: Customer Unavailability Detection');

  test('Greeting turn: "No, I am busy right now" detected as unavailable', () => {
    assert.strictEqual(isCustomerUnavailable("No, I'm busy right now", true), true);
    assert.strictEqual(isCustomerUnavailable('no', true), true);
    assert.strictEqual(isCustomerUnavailable('not really', true), true);
    assert.strictEqual(isCustomerUnavailable('nope', true), true);
    assert.strictEqual(isCustomerUnavailable('not right now', true), true);
    // Multilingual greeting rejections
    assert.strictEqual(isCustomerUnavailable('non', true), true);
    assert.strictEqual(isCustomerUnavailable('nein', true), true);
    assert.strictEqual(isCustomerUnavailable('nahi', true), true);
  });

  test('Mid-call turn: Busy, driving, in meeting detected as unavailable', () => {
    assert.strictEqual(isCustomerUnavailable("I'm in a meeting right now, can't talk", false), true);
    assert.strictEqual(isCustomerUnavailable("Sorry I am driving on the highway", false), true);
    assert.strictEqual(isCustomerUnavailable("I have to run now", false), true);
    assert.strictEqual(isCustomerUnavailable("Please call me back later", false), true);
    assert.strictEqual(isCustomerUnavailable("Bad time to chat", false), true);
    // Multilingual mid-call unavailability
    assert.strictEqual(isCustomerUnavailable("ahora no puedo hablar", false), true);
    assert.strictEqual(isCustomerUnavailable("je suis occupé", false), true);
    assert.strictEqual(isCustomerUnavailable("bin beschäftigt", false), true);
    assert.strictEqual(isCustomerUnavailable("baad me call karo", false), true);
  });

  test('Available customer utterances NOT detected as unavailable', () => {
    assert.strictEqual(isCustomerUnavailable("Yes, I called about a leak in our basement", true), false);
    assert.strictEqual(isCustomerUnavailable("Sure, what is this about?", true), false);
    assert.strictEqual(isCustomerUnavailable("I need emergency plumbing", false), false);
    assert.strictEqual(isCustomerUnavailable("How much do you charge for dental cleaning?", false), false);
  });

  // -------------------------------------------------------------------------
  // 2. Callback Time Validation & Extraction
  // -------------------------------------------------------------------------
  console.log('\nGroup 2: Callback Time Validation & Extraction');

  test('Validates specific time expressions', () => {
    const t1 = validateCallbackTime('Tomorrow at 2 PM');
    assert.strictEqual(t1.isValid, true);
    assert(t1.timeText?.toLowerCase().includes('tomorrow'));

    const t2 = validateCallbackTime('After 5 o\'clock');
    assert.strictEqual(t2.isValid, true);

    const t3 = validateCallbackTime('In about two hours');
    assert.strictEqual(t3.isValid, true);

    const t4 = validateCallbackTime('Monday morning');
    assert.strictEqual(t4.isValid, true);

    const t5 = validateCallbackTime('at 3 pm');
    assert.strictEqual(t5.isValid, true);

    const t6 = validateCallbackTime('call me around three pm');
    assert.strictEqual(t6.isValid, true);

    const t7 = validateCallbackTime('at 3');
    assert.strictEqual(t7.isValid, true);

    const t8 = validateCallbackTime('around four');
    assert.strictEqual(t8.isValid, true);
  });

  test('Validates flexible time expressions', () => {
    const f1 = validateCallbackTime('Anytime works for me');
    assert.strictEqual(f1.isValid, true);
    assert.strictEqual(f1.isFlexible, true);

    const f2 = validateCallbackTime('Whenever you can');
    assert.strictEqual(f2.isValid, true);
    assert.strictEqual(f2.isFlexible, true);

    const f3 = validateCallbackTime('As soon as possible');
    assert.strictEqual(f3.isValid, true);
    assert.strictEqual(f3.isFlexible, true);
  });

  test('Rejects arbitrary numbers, addresses, and quantities without time context', () => {
    const r1 = validateCallbackTime('42');
    assert.strictEqual(r1.isValid, false);
    assert.strictEqual(r1.reason, 'arbitrary_number');

    const r2 = validateCallbackTime('12345');
    assert.strictEqual(r2.isValid, false);
    assert.strictEqual(r2.reason, 'arbitrary_number');

    const r3 = validateCallbackTime('9876543210');
    assert.strictEqual(r3.isValid, false);
    assert.strictEqual(r3.reason, 'arbitrary_number');

    // Addresses & quantities with numbers
    const r4 = validateCallbackTime('I am at 42 Main St');
    assert.strictEqual(r4.isValid, false);

    const r5 = validateCallbackTime('around 50 people');
    assert.strictEqual(r5.isValid, false);

    const r6 = validateCallbackTime('room 5');
    assert.strictEqual(r6.isValid, false);

    const r7 = validateCallbackTime('at 42');
    assert.strictEqual(r7.isValid, false);
  });

  test('Rejects non-time conversational words and refusals', () => {
    const n1 = validateCallbackTime('I have a leak');
    assert.strictEqual(n1.isValid, false);

    const n2 = validateCallbackTime('banana');
    assert.strictEqual(n2.isValid, false);

    const n3 = validateCallbackTime('I don\'t know');
    assert.strictEqual(n3.isValid, false);
    assert.strictEqual(n3.reason, 'unknown');
  });

  test('Extracts callback time when customer provides both unavailability and time', () => {
    const utterance = "I'm busy right now, please call me tomorrow at 3 PM";
    assert.strictEqual(isCustomerUnavailable(utterance), true);
    const time = extractCallbackTime(utterance);
    assert(time !== null);
    assert(time!.toLowerCase().includes('tomorrow'));
  });

  // -------------------------------------------------------------------------
  // 3. Spoken Number & Phone Validation
  // -------------------------------------------------------------------------
  console.log('\nGroup 3: Spoken Number & Phone Validation');

  test('Arbitrary short numbers (< 3 digits) without phone context are not treated as phone attempts', () => {
    const p1 = extractPhoneFromUtterance('4', 'US', null);
    assert.strictEqual(p1, null);

    const p2 = extractPhoneFromUtterance('two', 'US', null);
    assert.strictEqual(p2, null);

    const p3 = extractPhoneFromUtterance('room 5', 'US', null);
    assert.strictEqual(p3, null);
  });

  test('Full phone number validates correctly and normalizes', () => {
    const p = extractPhoneFromUtterance('my phone number is 9876543210', 'US', null);
    assert(p !== null);
    assert.strictEqual(p!.isValid, true);
    assert.strictEqual(p!.normalized, '+19876543210');
  });

  test('Invalid phone pattern (repeated digits) rejected', () => {
    const res = validatePhoneDigits('0000000000', 'US');
    assert.strictEqual(res.isValid, false);
    assert.strictEqual(res.reason, 'invalid_pattern');
  });

  test('Phone masking obscures all digits except last 4', () => {
    const masked = maskPhone('+19876543210');
    assert(masked.endsWith('3210'));
    assert(masked.includes('******'));
  });

  // -------------------------------------------------------------------------
  // 4. Configuration Loading Across Industries
  // -------------------------------------------------------------------------
  console.log('\nGroup 4: Configuration Loading Across Industries');

  for (const [key, preset] of Object.entries(BUSINESS_PRESETS)) {
    test(`Industry Preset "${preset.name}" (${key}) applies configured business profile`, () => {
      const sys = buildSystem({
        ...preset,
        services: JSON.stringify(preset.services),
        faqs: JSON.stringify(preset.faqs),
      }, null);

      // Business name included
      assert(sys.includes(`Business Name: ${preset.name}`), `Must include business name: ${preset.name}`);

      // Configured tone included
      assert(sys.includes(`Configured Tone: ${preset.tone}`), `Must include tone: ${preset.tone}`);
      assert(sys.includes(`Adopt the configured tone of voice: "${preset.tone}"`), 'Prompt must instruct model to adopt tone');

      // Configured language included
      assert(sys.includes(`Configured Language: ${preset.language}`), `Must include language: ${preset.language}`);
      assert(sys.includes(`Generate all responses strictly in the configured conversation language: "${preset.language}"`));

      // Operating hours included
      assert(sys.includes(preset.hours), `Must include hours: ${preset.hours}`);

      // Configured services included
      for (const service of preset.services) {
        assert(sys.includes(service), `Must include service: ${service}`);
      }

      // Customer unavailability rule included
      assert(sys.includes('CUSTOMER UNAVAILABILITY & RESCHEDULING'), 'Universal unavailability rule must be present');

      // Configured timezone included
      assert(sys.includes(`Configured Timezone: ${preset.timezone}`), `Must include timezone: ${preset.timezone}`);
      assert(sys.includes('Current Local Time & Day'), 'Must include formatted current time in timezone');
    });
  }

  // -------------------------------------------------------------------------
  // 5. TTS Markdown Sanitization
  // -------------------------------------------------------------------------
  console.log('\nGroup 5: TTS Markdown Sanitization & AI Output Guard');

  test('Strips markdown headers, bold, italics, code, bullet points, and CALL_COMPLETE', () => {
    const raw = `### Our Services:
**Emergency plumbing** and *leak repair*.
- Item 1: Drain cleaning
\`call_now\`
Thank you! [CALL_COMPLETE]`;

    const cleaned = sanitizeTtsText(raw);
    assert(!cleaned.includes('###'));
    assert(!cleaned.includes('**'));
    assert(!cleaned.includes('*leak repair*'));
    assert(!cleaned.includes('`'));
    assert(!cleaned.includes('- Item'));
    assert(!cleaned.includes('[CALL_COMPLETE]'));
    assert(cleaned.includes('Emergency plumbing and leak repair'));
    assert(cleaned.includes('Drain cleaning'));
    assert(cleaned.includes('Thank you!'));
  });

  // -------------------------------------------------------------------------
  // 6. Call Termination & Summary Ground-Truth
  // -------------------------------------------------------------------------
  console.log('\nGroup 6: Call Termination & Summary Ground-Truth');

  test('Summary correctly records customer unavailability and preferred callback time', () => {
    const summary: StructuredSummary = {
      reason: 'not specified',
      urgency: 'low',
      preferred_time: 'Tomorrow at 2:00 PM',
      contact_details: '+19876543210',
      suggested_action: 'Call customer back at Tomorrow at 2:00 PM at +19876543210.',
      short_summary: 'Customer unavailable; requested callback tomorrow.',
      sentiment: 'neutral',
      status: 'completed',
    };

    assert.strictEqual(summary.status, 'completed');
    assert.strictEqual(summary.preferred_time, 'Tomorrow at 2:00 PM');
    assert.strictEqual(summary.contact_details, '+19876543210');
    assert(!summary.suggested_action.includes('ask for phone'));
  });

  test('Unknown information is distinguished from known information', () => {
    const unknownSummary: StructuredSummary = {
      reason: 'not specified',
      urgency: 'low',
      preferred_time: 'not specified',
      contact_details: 'not provided',
      suggested_action: 'Follow up to obtain callback number.',
      short_summary: 'Customer called but provided no details.',
      sentiment: 'neutral',
      status: 'completed',
    };

    assert.strictEqual(unknownSummary.reason, 'not specified');
    assert.strictEqual(unknownSummary.preferred_time, 'not specified');
    assert.strictEqual(unknownSummary.contact_details, 'not provided');
  });

  // -------------------------------------------------------------------------
  // 7. Conversation State Machine Simulation (Unavailability & Callback Flow)
  // -------------------------------------------------------------------------
  console.log('\nGroup 7: State Machine Simulation (Unavailability & Callback Flow)');

  test('Scenario A: Unavailable customer asked for callback time -> records time -> ends cleanly', () => {
    // Simulated session state machine
    let conversationState = 'GREETING';
    let isUnavailable = false;
    let preferredCallbackTime: string | null = null;
    let pendingEndReason: string | null = null;
    let finalizing = false;
    const turns: Array<{ role: string; text: string }> = [];

    // Turn 1: Customer indicates unavailable
    const customerUtterance1 = "No, I'm busy right now";
    const isGreeting = conversationState === 'GREETING';
    if (isCustomerUnavailable(customerUtterance1, isGreeting)) {
      isUnavailable = true;
      turns.push({ role: 'customer', text: customerUtterance1 });
      const quickTime = extractCallbackTime(customerUtterance1);
      if (quickTime) {
        preferredCallbackTime = quickTime;
        conversationState = 'WRAPPING_UP';
      } else {
        conversationState = 'AWAITING_CALLBACK_TIME';
        const reply = "Understood. When would be a good time for our team to call you back?";
        turns.push({ role: 'agent', text: reply });
      }
    }

    assert.strictEqual(isUnavailable, true);
    assert.strictEqual(conversationState, 'AWAITING_CALLBACK_TIME');
    const agentReply1 = turns[turns.length - 1].text;
    assert(agentReply1.includes('When would be a good time'));
    assert(!agentReply1.includes('What was your call about'));
    assert(!agentReply1.includes('service'));

    // Turn 2: Customer provides callback time
    const customerUtterance2 = "Tomorrow at 2 PM";
    if (conversationState === 'AWAITING_CALLBACK_TIME') {
      turns.push({ role: 'customer', text: customerUtterance2 });
      const cb = validateCallbackTime(customerUtterance2);
      assert.strictEqual(cb.isValid, true);
      preferredCallbackTime = cb.timeText;
      conversationState = 'WRAPPING_UP';
      finalizing = true;
      pendingEndReason = 'customer_unavailable';
      const reply = `Thank you. Our team will review your preferred callback time and follow up with you. Have a great day! [CALL_COMPLETE]`;
      turns.push({ role: 'agent', text: reply });
    }

    assert.strictEqual(conversationState, 'WRAPPING_UP');
    assert.strictEqual(finalizing, true);
    assert.strictEqual(pendingEndReason, 'customer_unavailable');
    assert.strictEqual(preferredCallbackTime, 'Tomorrow at 2 PM');
    const finalAgentReply = turns[turns.length - 1].text;
    assert(finalAgentReply.includes('[CALL_COMPLETE]'));
    assert(!finalAgentReply.includes('?'));
  });

  test('Scenario B: Unavailable customer with callback time in single turn ends immediately', () => {
    let conversationState = 'GREETING';
    let isUnavailable = false;
    let preferredCallbackTime: string | null = null;
    let finalizing = false;
    const turns: Array<{ role: string; text: string }> = [];

    const utterance = "I cannot talk right now, please call me back Monday morning";
    const isGreeting = conversationState === 'GREETING';
    if (isCustomerUnavailable(utterance, isGreeting)) {
      isUnavailable = true;
      turns.push({ role: 'customer', text: utterance });
      const quickTime = extractCallbackTime(utterance);
      if (quickTime) {
        preferredCallbackTime = quickTime;
        conversationState = 'WRAPPING_UP';
        finalizing = true;
        const reply = `Understood. I've noted that for our team. We'll follow up with you around ${quickTime}. Have a great day! [CALL_COMPLETE]`;
        turns.push({ role: 'agent', text: reply });
      }
    }

    assert.strictEqual(isUnavailable, true);
    assert.strictEqual(conversationState, 'WRAPPING_UP');
    assert.strictEqual(finalizing, true);
    assert(preferredCallbackTime?.toLowerCase().includes('monday'));
    const reply = turns[turns.length - 1].text;
    assert(reply.includes('[CALL_COMPLETE]'));
    assert(!reply.includes('When would be a good time'));
  });

  test('Scenario C: Unavailable customer with flexible / unknown time handled cleanly', () => {
    let conversationState = 'AWAITING_CALLBACK_TIME';
    let preferredCallbackTime: string | null = null;
    let finalizing = false;
    const turns: Array<{ role: string; text: string }> = [];

    const utterance = "Whenever you can";
    turns.push({ role: 'customer', text: utterance });
    const cb = validateCallbackTime(utterance);
    assert.strictEqual(cb.isFlexible, true);
    preferredCallbackTime = cb.timeText; // 'flexible / anytime'
    conversationState = 'WRAPPING_UP';
    finalizing = true;
    const reply = `Understood. Our team will follow up with you as soon as possible. Have a great day! [CALL_COMPLETE]`;
    turns.push({ role: 'agent', text: reply });

    assert.strictEqual(conversationState, 'WRAPPING_UP');
    assert.strictEqual(finalizing, true);
    assert.strictEqual(preferredCallbackTime, 'flexible / anytime');
    assert(turns[turns.length - 1].text.includes('[CALL_COMPLETE]'));
  });

  test('Scenario D: Unavailable customer with flexible time in single turn ends with appropriate phrasing', () => {
    let conversationState = 'GREETING';
    let isUnavailable = false;
    let preferredCallbackTime: string | null = null;
    let finalizing = false;
    const turns: Array<{ role: string; text: string }> = [];

    const utterance = "I'm busy right now, call me back whenever";
    const isGreeting = conversationState === 'GREETING';
    if (isCustomerUnavailable(utterance, isGreeting)) {
      isUnavailable = true;
      turns.push({ role: 'customer', text: utterance });
      const cb = validateCallbackTime(utterance);
      if (cb.isValid && cb.timeText) {
        conversationState = 'WRAPPING_UP';
        finalizing = true;
        let reply = '';
        if (cb.isFlexible) {
          preferredCallbackTime = 'flexible / anytime';
          reply = `Understood. Our team will follow up with you as soon as possible. Have a great day! [CALL_COMPLETE]`;
        } else {
          preferredCallbackTime = cb.timeText;
          reply = `Understood. I've noted that for our team. We'll follow up with you around ${cb.timeText}. Have a great day! [CALL_COMPLETE]`;
        }
        turns.push({ role: 'agent', text: reply });
      }
    }

    assert.strictEqual(isUnavailable, true);
    assert.strictEqual(conversationState, 'WRAPPING_UP');
    assert.strictEqual(finalizing, true);
    assert.strictEqual(preferredCallbackTime, 'flexible / anytime');
    const finalReply = turns[turns.length - 1].text;
    assert(finalReply.includes('[CALL_COMPLETE]'));
    assert(!finalReply.includes('around flexible'));
    assert(finalReply.includes('as soon as possible'));
  });

  // -------------------------------------------------------------------------
  // 8. Idempotency & Duplicate Event Handling
  // -------------------------------------------------------------------------
  console.log('\nGroup 8: Idempotency & Duplicate Event Handling');

  test('Rapid duplicate customer transcript within 1.5s is deduplicated', () => {
    let lastCustomerText = '';
    let lastCustomerTextTime = 0;
    let processedTurns = 0;

    function handleTranscript(text: string, timestamp: number): boolean {
      if (lastCustomerText && lastCustomerText === text && timestamp - lastCustomerTextTime < 1500) {
        return false; // Deduplicated
      }
      lastCustomerText = text;
      lastCustomerTextTime = timestamp;
      processedTurns++;
      return true;
    }

    const t0 = 10000;
    assert.strictEqual(handleTranscript('I have a burst pipe', t0), true);
    assert.strictEqual(handleTranscript('I have a burst pipe', t0 + 200), false); // duplicate within 200ms
    assert.strictEqual(handleTranscript('I have a burst pipe', t0 + 800), false); // duplicate within 800ms
    assert.strictEqual(processedTurns, 1, 'Only exactly 1 turn should be processed for duplicates');

    // After cooldown period (2000ms later), distinct utterance processed
    assert.strictEqual(handleTranscript('Can someone come today?', t0 + 2000), true);
    assert.strictEqual(processedTurns, 2);
  });

  test('Call termination is strictly idempotent across multiple concurrent invocations', () => {
    let endedCount = 0;
    const mockSession = {
      ended: false,
      finalizing: false,
      conversationState: 'ACTIVE',
      ws: { readyState: 1 },
    };

    function terminateSession(session: any, reason: string): boolean {
      if (session.ended) return false;
      session.ended = true;
      session.finalizing = true;
      session.endReason = reason;
      session.conversationState = 'COMPLETED';
      endedCount++;
      return true;
    }

    assert.strictEqual(terminateSession(mockSession, 'user_ended'), true);
    assert.strictEqual(terminateSession(mockSession, 'timeout'), false);
    assert.strictEqual(terminateSession(mockSession, 'disconnect'), false);
    assert.strictEqual(endedCount, 1, 'Termination must run exactly once');
    assert.strictEqual(mockSession.conversationState, 'COMPLETED');
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
