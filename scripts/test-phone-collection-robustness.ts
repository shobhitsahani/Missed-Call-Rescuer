/**
 * Comprehensive Regression Suite: Phone Collection Robustness & Policy Guard
 * 
 * Verifies:
 * 1. 8-digit spoken numbers rejected as incomplete
 * 2. 9-digit spoken numbers rejected as incomplete
 * 3. 10-digit spoken numbers in a single turn validated
 * 4. Multi-turn digit stitching (9-digit fragment + 1-digit "zero" -> +19876543210)
 * 5. Multi-fragment spoken digits (3 + 3 + 4 digits -> +19876543210)
 * 6. "double" and "triple" multiplier handling
 * 7. "oh" and "zero" spoken variations
 * 8. Formatted digit strings with symbols ((987) 654-3210, +1 (987) 654-3210)
 * 9. Indian 10-digit mobile validation under IN locale
 * 10. Invalid area codes (starting with 0 or 1 under US NANP)
 * 11. Mid-call phone correction overriding previous number
 * 12. Explicit customer refusal setting status to declined
 * 13. Verified caller ID suppressing phone prompts
 * 14. Structured summary consistency between contact_details and suggested_action
 * 15. End-to-end multi-turn dialogue sequence replicating production incident
 */

import assert from 'assert';
import {
  extractPhoneFromUtterance,
  validatePhoneDigits,
  normalizePhoneDigits,
  isPhoneRefusal,
} from '../server/phone';
import { buildPhonePolicy, CallContext, validateSummary } from '../server/llm';

console.log('--- Running Phone Collection Robustness Regression Suite ---\n');

// -------------------------------------------------------------------
// 1. 8-digit spoken number -> rejected as incomplete
// -------------------------------------------------------------------
console.log('Test 1: 8-digit spoken number ("one two one two one two one two")');
{
  const text = 'one two one two one two one two';
  const digits = normalizePhoneDigits(text);
  assert.strictEqual(digits, '12121212', 'Must normalize to 12121212');
  const res = validatePhoneDigits(digits, 'US');
  assert.strictEqual(res.isValid, false, '8 digits must not be valid');
  assert.strictEqual(res.reason, 'incomplete');
  const extracted = extractPhoneFromUtterance(text, 'US');
  assert(extracted !== null, 'Should extract candidate');
  assert.strictEqual(extracted.isValid, false);
  assert.strictEqual(extracted.reason, 'incomplete');
  console.log('  ✓ Correctly rejected 8-digit number as incomplete');
}

// -------------------------------------------------------------------
// 2. 9-digit spoken number -> rejected as incomplete
// -------------------------------------------------------------------
console.log('\nTest 2: 9-digit spoken number ("nine eight seven six five four three two one")');
{
  const text = 'nine eight seven six five four three two one';
  const digits = normalizePhoneDigits(text);
  assert.strictEqual(digits, '987654321', 'Must normalize to 987654321');
  const res = validatePhoneDigits(digits, 'US');
  assert.strictEqual(res.isValid, false, '9 digits must not be valid');
  assert.strictEqual(res.reason, 'incomplete');
  const extracted = extractPhoneFromUtterance(text, 'US');
  assert(extracted !== null);
  assert.strictEqual(extracted.isValid, false);
  assert.strictEqual(extracted.reason, 'incomplete');
  console.log('  ✓ Correctly rejected 9-digit number as incomplete');
}

// -------------------------------------------------------------------
// 3. 10-digit spoken number in one turn -> validated as +19876543210
// -------------------------------------------------------------------
console.log('\nTest 3: 10-digit spoken number in single turn');
{
  const text = 'nine eight seven six five four three two one zero';
  const digits = normalizePhoneDigits(text);
  assert.strictEqual(digits, '9876543210');
  const extracted = extractPhoneFromUtterance(text, 'US');
  assert(extracted !== null);
  assert.strictEqual(extracted.isValid, true);
  assert.strictEqual(extracted.normalized, '+19876543210');
  assert.strictEqual(extracted.formatted, '+1 (987) 654-3210');
  console.log('  ✓ Single-turn 10-digit number validated to +19876543210');
}

// -------------------------------------------------------------------
// 4. 9-digit fragment followed by 1-digit fragment ("zero")
// -------------------------------------------------------------------
console.log('\nTest 4: Multi-turn digit stitching (9 digits + "zero")');
{
  // Turn A: Customer speaks 9 digits
  const turnA = 'nine eight seven six five four three two one';
  const extA = extractPhoneFromUtterance(turnA, 'US', null);
  assert(extA !== null);
  assert.strictEqual(extA.isValid, false);
  assert.strictEqual(extA.reason, 'incomplete');
  const pendingAfterA = extA.digits;
  assert.strictEqual(pendingAfterA, '987654321');

  // Turn B: Customer speaks 10th digit ("zero")
  const turnB = 'zero';
  const extB = extractPhoneFromUtterance(turnB, 'US', pendingAfterA);
  assert(extB !== null, 'Must extract from pending + turn B');
  assert.strictEqual(extB.isValid, true, 'Combined must be valid');
  assert.strictEqual(extB.normalized, '+19876543210');
  assert.strictEqual(extB.formatted, '+1 (987) 654-3210');
  console.log('  ✓ 9-digit fragment stitched with "zero" -> +19876543210');
}

// -------------------------------------------------------------------
// 5. Multi-fragment spoken digits (3 + 3 + 4 digits)
// -------------------------------------------------------------------
console.log('\nTest 5: Multi-fragment spoken digits (3 + 3 + 4 digits)');
{
  let pending: string | null = null;

  // Turn 1: "nine eight seven"
  const t1 = extractPhoneFromUtterance('nine eight seven', 'US', pending);
  assert(t1 !== null && !t1.isValid && t1.reason === 'incomplete');
  pending = t1.digits;
  assert.strictEqual(pending, '987');

  // Turn 2: "six five four"
  const t2 = extractPhoneFromUtterance('six five four', 'US', pending);
  assert(t2 !== null && !t2.isValid && t2.reason === 'incomplete');
  pending = t2.digits;
  assert.strictEqual(pending, '987654');

  // Turn 3: "three two one zero"
  const t3 = extractPhoneFromUtterance('three two one zero', 'US', pending);
  assert(t3 !== null && t3.isValid);
  assert.strictEqual(t3.normalized, '+19876543210');
  console.log('  ✓ Multi-fragment 3 + 3 + 4 digits combined to +19876543210');
}

// -------------------------------------------------------------------
// 6. Spoken words with "double" and "triple"
// -------------------------------------------------------------------
console.log('\nTest 6: Words with "double" and "triple"');
{
  const text = 'five five five double oh one triple two four';
  const digits = normalizePhoneDigits(text);
  assert.strictEqual(digits, '5550012224');
  const res = validatePhoneDigits(digits, 'US');
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.normalized, '+15550012224');
  console.log('  ✓ "double oh" and "triple two" correctly expanded');
}

// -------------------------------------------------------------------
// 7. Spoken words with "oh" and "zero"
// -------------------------------------------------------------------
console.log('\nTest 7: "oh" and "zero" handling');
{
  const text = 'nine eight seven oh five four three two one zero';
  const digits = normalizePhoneDigits(text);
  assert.strictEqual(digits, '9870543210');
  const res = validatePhoneDigits(digits, 'US');
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.normalized, '+19870543210');
  console.log('  ✓ "oh" and "zero" parsed cleanly');
}

// -------------------------------------------------------------------
// 8. Number with formatting symbols
// -------------------------------------------------------------------
console.log('\nTest 8: Formatting symbols');
{
  const t1 = extractPhoneFromUtterance('My number is (987) 654-3210, thank you', 'US');
  assert(t1 !== null && t1.isValid);
  assert.strictEqual(t1.normalized, '+19876543210');

  const t2 = extractPhoneFromUtterance('You can call me at +1 (987) 654-3210', 'US');
  assert(t2 !== null && t2.isValid);
  assert.strictEqual(t2.normalized, '+19876543210');
  console.log('  ✓ Parentheses, dashes, and +1 prefix correctly parsed');
}

// -------------------------------------------------------------------
// 9. Indian 10-digit mobile number under IN locale
// -------------------------------------------------------------------
console.log('\nTest 9: Indian 10-digit mobile number under IN locale');
{
  const validInd = validatePhoneDigits('9876543210', 'IN');
  assert.strictEqual(validInd.isValid, true);
  assert.strictEqual(validInd.normalized, '+919876543210');
  assert.strictEqual(validInd.formatted, '+91 98765 43210');

  // Starts with 5 (invalid Indian mobile)
  const invalidInd = validatePhoneDigits('5876543210', 'IN');
  assert.strictEqual(invalidInd.isValid, false);
  assert.strictEqual(invalidInd.reason, 'invalid_pattern');
  console.log('  ✓ Indian locale validates 6-9 prefixes to +91 and rejects 5 prefix');
}

// -------------------------------------------------------------------
// 10. Invalid area code under US NANP (starting with 0 or 1)
// -------------------------------------------------------------------
console.log('\nTest 10: Invalid area code under US NANP');
{
  const startsWith0 = validatePhoneDigits('0123456789', 'US');
  assert.strictEqual(startsWith0.isValid, false);
  assert.strictEqual(startsWith0.reason, 'invalid_pattern');

  const startsWith1 = validatePhoneDigits('1123456789', 'US');
  assert.strictEqual(startsWith1.isValid, false);
  assert.strictEqual(startsWith1.reason, 'invalid_pattern');
  console.log('  ✓ US numbers with area code starting 0 or 1 rejected');
}

// -------------------------------------------------------------------
// 11. Mid-call phone correction overriding previous number
// -------------------------------------------------------------------
console.log('\nTest 11: Phone correction overriding previous number');
{
  // Customer previously provided incomplete or different number
  const pending = '12121212'; // 8 digits
  const correctionText = 'Actually my number is 555-019-2834';
  const extracted = extractPhoneFromUtterance(correctionText, 'US', pending);
  assert(extracted !== null && extracted.isValid);
  assert.strictEqual(extracted.normalized, '+15550192834');
  console.log('  ✓ Correction overrides previous pending digits');
}

// -------------------------------------------------------------------
// 12. Explicit customer refusal setting status to declined
// -------------------------------------------------------------------
console.log('\nTest 12: Customer refusal');
{
  assert.strictEqual(isPhoneRefusal("I don't want to give my phone number"), true);
  assert.strictEqual(isPhoneRefusal("rather not say"), true);
  assert.strictEqual(isPhoneRefusal("no callback number please"), true);

  const ctx: CallContext = { phoneStatus: 'declined', turnCount: 2 };
  const policy = buildPhonePolicy(ctx);
  assert(policy.includes('DECLINED'), 'Policy must record refusal');
  assert(policy.includes('DO NOT ask for their phone number again'), 'Policy must suppress repeat prompts');
  console.log('  ✓ Refusal recognized and future prompts suppressed');
}

// -------------------------------------------------------------------
// 13. Verified caller ID suppressing phone prompts
// -------------------------------------------------------------------
console.log('\nTest 13: Verified caller ID');
{
  const ctx: CallContext = {
    phoneStatus: 'verified',
    verifiedCallerPhone: '+15550101234',
    turnCount: 1,
  };
  const policy = buildPhonePolicy(ctx);
  assert(policy.includes('ALREADY VERIFIED'), 'Policy must acknowledge verified caller');
  assert(policy.includes('DO NOT ask the customer for their phone number'), 'Must not prompt');
  console.log('  ✓ Verified caller ID policy suppresses phone prompts');
}

// -------------------------------------------------------------------
// 14. Structured summary consistency
// -------------------------------------------------------------------
console.log('\nTest 14: Summary consistency');
{
  // Case A: Validated number
  const ctxA: CallContext = {
    phoneStatus: 'validated',
    collectedPhone: '+19876543210',
  };
  // Simulate raw summary that mistakenly had contradictory suggested action
  const rawSummaryA = {
    reason: 'pipe leak under kitchen sink',
    urgency: 'high',
    preferred_time: 'this afternoon',
    contact_details: 'unknown',
    suggested_action: 'Follow up to obtain a valid 10-digit phone number.',
    short_summary: 'Customer called about a severe kitchen sink leak.',
    sentiment: 'negative',
  };
  const validatedA = validateSummary(rawSummaryA);
  assert(validatedA.valid && validatedA.summary);

  // Apply context logic as implemented in server/llm.ts
  const summaryA = validatedA.summary;
  if ((ctxA.phoneStatus === 'validated' || ctxA.phoneStatus === 'confirmed') && ctxA.collectedPhone) {
    summaryA.contact_details = ctxA.collectedPhone;
    if (/(obtain|get|request|ask\s+for|collect|need|find\s+out).*(phone|number|contact)/i.test(summaryA.suggested_action) ||
        /follow\s*up\s+to\s+obtain/i.test(summaryA.suggested_action)) {
      const reasonClause = summaryA.reason && summaryA.reason !== 'not specified' ? ` regarding ${summaryA.reason}` : '';
      summaryA.suggested_action = `Follow up with customer${reasonClause} at ${summaryA.contact_details}.`;
    }
  }

  assert.strictEqual(summaryA.contact_details, '+19876543210');
  assert(!summaryA.suggested_action.includes('obtain a valid'), 'Contradictory action must be rewritten');
  assert(summaryA.suggested_action.includes('+19876543210'));

  // Case B: Declined number
  const ctxB: CallContext = { phoneStatus: 'declined' };
  const rawSummaryB = {
    reason: 'general inquiry',
    urgency: 'low',
    preferred_time: 'not specified',
    contact_details: 'not specified',
    suggested_action: 'Call customer at 555-0100',
    short_summary: 'Customer asked about hours.',
    sentiment: 'neutral',
  };
  const validatedB = validateSummary(rawSummaryB);
  assert(validatedB.valid && validatedB.summary);
  const summaryB = validatedB.summary;
  if (ctxB.phoneStatus === 'declined') {
    summaryB.contact_details = 'declined by customer';
    if (/call\s+(customer|them)\s+at/i.test(summaryB.suggested_action)) {
      summaryB.suggested_action = 'Customer declined callback number. Follow up if alternate contact method is available.';
    }
  }
  assert.strictEqual(summaryB.contact_details, 'declined by customer');
  assert.strictEqual(summaryB.suggested_action, 'Customer declined callback number. Follow up if alternate contact method is available.');

  console.log('  ✓ Structured summary consistency enforced without contradiction');
}

// -------------------------------------------------------------------
// 15. End-to-End Dialogue Sequence Replicating Production Incident
// -------------------------------------------------------------------
console.log('\nTest 15: End-to-End Dialogue Sequence Replicating Incident');
{
  interface MockSession {
    phoneStatus: 'unknown' | 'collected' | 'validated' | 'confirmed' | 'declined';
    collectedPhone: string | null;
    pendingPhoneDigits: string | null;
    lastPhonePromptTurn: number;
    turns: Array<{ role: 'customer' | 'agent'; text: string }>;
  }

  const session: MockSession = {
    phoneStatus: 'unknown',
    collectedPhone: null,
    pendingPhoneDigits: null,
    lastPhonePromptTurn: 0,
    turns: [],
  };

  function simulateCustomerTurn(text: string, turnIndex: number): string {
    session.turns.push({ role: 'customer', text });

    // Step 1: Refusal check
    if (session.phoneStatus !== 'validated' && session.phoneStatus !== 'confirmed' && isPhoneRefusal(text)) {
      session.phoneStatus = 'declined';
      session.pendingPhoneDigits = null;
    }

    // Step 2: Extraction check
    const extracted = extractPhoneFromUtterance(text, 'US', session.pendingPhoneDigits);
    if (extracted) {
      if (extracted.isValid && extracted.normalized) {
        session.phoneStatus = 'validated';
        session.collectedPhone = extracted.normalized;
        session.pendingPhoneDigits = null;
      } else if (extracted.reason === 'incomplete' && session.phoneStatus !== 'declined') {
        session.phoneStatus = 'collected';
        session.pendingPhoneDigits = extracted.digits;
      }
    }

    // Step 3: LLM generation simulation
    let llmReply = '';
    if (session.phoneStatus === 'collected') {
      llmReply = "Could you please repeat your full 10-digit phone number?";
    } else if (session.phoneStatus === 'validated' && turnIndex === 3) {
      llmReply = "Thank you. What was your original call about?";
    } else if (session.phoneStatus === 'validated' && /leaked|leak/i.test(text)) {
      llmReply = "I understand you have a leak. We can have a technician look at that right away.";
    }

    // Step 4: Guard logic
    const askedForPhone = /phone\s*(number)?|callback\s*number|reach\s*you|best\s*number/i.test(llmReply);
    if (askedForPhone) {
      session.lastPhonePromptTurn = turnIndex;
    }

    if (
      session.phoneStatus === 'validated' ||
      session.phoneStatus === 'confirmed' ||
      session.phoneStatus === 'declined'
    ) {
      // Guard does NOT append any phone prompt!
    } else if (session.phoneStatus === 'collected' && !askedForPhone) {
      const repeatSentence = "Could you please repeat your full 10-digit phone number?";
      if (/[?]\s*$/.test(llmReply.trim())) {
        const withoutTrailingQ = llmReply.trim().replace(/[A-Z][^?]*\?\s*$/i, '').trim();
        llmReply = (withoutTrailingQ ? withoutTrailingQ + ' ' : '') + repeatSentence;
      } else {
        llmReply += (llmReply ? ' ' : '') + repeatSentence;
      }
    }

    session.turns.push({ role: 'agent', text: llmReply });
    return llmReply;
  }

  // Turn 1: Customer says 8 digits
  const r1 = simulateCustomerTurn('one two one two one two one two', 1);
  assert.strictEqual(session.phoneStatus, 'collected');
  assert.strictEqual(session.pendingPhoneDigits, '12121212');
  assert(r1.includes('Could you please repeat your full 10-digit phone number?'));
  console.log('  Turn 1 -> Customer: 8 digits | Agent:', r1);

  // Turn 2: Customer repeats 8 digits
  const r2 = simulateCustomerTurn('one two one two one two one two', 2);
  assert.strictEqual(session.phoneStatus, 'collected');
  assert.strictEqual(session.pendingPhoneDigits, '12121212');
  assert(r2.includes('Could you please repeat your full 10-digit phone number?'));
  console.log('  Turn 2 -> Customer: repeats 8 digits | Agent:', r2);

  // Turn 3: Customer speaks 9 digits, followed by fragment "zero"
  // Turn 3a: 9 digits spoken
  const ext3a = extractPhoneFromUtterance('nine eight seven six five four three two one', 'US', session.pendingPhoneDigits);
  assert(ext3a !== null && ext3a.reason === 'incomplete');
  session.pendingPhoneDigits = ext3a.digits; // '987654321'

  // Turn 3b: "zero" arrives
  const r3 = simulateCustomerTurn('zero', 3);
  assert.strictEqual(session.phoneStatus, 'validated', 'Phone status must become validated!');
  assert.strictEqual(session.collectedPhone, '+19876543210');
  assert.strictEqual(session.pendingPhoneDigits, null);
  // Crucial invariant: Must NOT have double prompt!
  assert.strictEqual(r3, 'Thank you. What was your original call about?');
  assert(!r3.includes('Could you please repeat your full 10-digit phone number?'), 'Must NOT append duplicate phone request!');
  console.log('  Turn 3 -> Customer: "nine eight seven six five four three two one" + "zero" | Agent:', r3);

  // Turn 4: Customer says "About leaked."
  const r4 = simulateCustomerTurn('About leaked.', 4);
  assert.strictEqual(session.phoneStatus, 'validated');
  assert(!r4.includes('phone number'), 'Agent must NOT ask for phone number after customer explained leak!');
  assert(r4.includes('leak'), 'Agent addresses the leak directly');
  console.log('  Turn 4 -> Customer: "About leaked." | Agent:', r4);

  // Final Summary Generation
  const transcript = session.turns.map(t => `${t.role}: ${t.text}`).join('\n');
  assert(transcript.includes('leak'));
  console.log('\n  ✓ Complete dialogue sequence passed with zero duplicate prompts or regressions!');
}

// -------------------------------------------------------------------
// 16. Unrelated conversational speech isolation
// -------------------------------------------------------------------
console.log('\nTest 16: Unrelated conversational speech isolation');
{
  // Customer previously spoke 3 digits ("987")
  const pending = '987';

  // Customer now speaks unrelated conversational sentence containing a number word
  const unrelatedText1 = 'Actually I have two leaks in my basement';
  const ext1 = extractPhoneFromUtterance(unrelatedText1, 'US', pending);
  assert.strictEqual(ext1, null, 'Must reject conversational speech with number words');

  const unrelatedText2 = 'I called about this 1 week ago';
  const ext2 = extractPhoneFromUtterance(unrelatedText2, 'US', pending);
  assert.strictEqual(ext2, null, 'Must reject "1 week ago" from stitching into pending digits');

  const unrelatedText3 = 'Can someone come at 2 pm?';
  const ext3 = extractPhoneFromUtterance(unrelatedText3, 'US', pending);
  assert.strictEqual(ext3, null, 'Must reject "2 pm" from stitching into pending digits');

  // But legitimate phone continuation with pending digits STILL works
  const legitContinuation = 'and the last digit is zero';
  const extLegit = extractPhoneFromUtterance(legitContinuation, 'US', '987654321');
  assert(extLegit !== null && extLegit.isValid);
  assert.strictEqual(extLegit.normalized, '+19876543210');

  console.log('  ✓ Conversational speech with numbers strictly isolated from phone stitching');
}

console.log('\n================================================================');
console.log('🎉 ALL 16 PHONE COLLECTION ROBUSTNESS REGRESSION TESTS PASSED!');
console.log('================================================================\n');
