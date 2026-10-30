import {
  maskPhoneNumber,
  sanitizeError,
  formatCallNotification,
  NotifyPayload,
  getActiveProvider,
  notifyCallSummary,
  sendTestNotification,
  resendCallNotification,
} from '../server/notify';
import db from '../server/db';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- 1. Testing Phone Masking ---');
assert(maskPhoneNumber('+91 9876543210') === '+91 ******3210', 'Mask +91 Indian mobile');
assert(maskPhoneNumber('+1 (555) 010-1234') === '+1 ******1234', 'Mask US formatted');
assert(maskPhoneNumber('+15550101234') === '+1 ******1234', 'Mask US e164');
assert(maskPhoneNumber('9876543210') === '987 ******3210', 'Mask 10-digit number without plus');
assert(maskPhoneNumber('unknown') === 'unknown', 'Unknown phone passthrough');
assert(maskPhoneNumber('') === 'unknown', 'Empty phone fallback');
console.log('✓ Phone masking tests passed');

console.log('--- 2. Testing Secret & Error Sanitization ---');
process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';
process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1234567890/tokenABC_123';

const rawErr = `Failed at https://api.telegram.org/bot123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ/sendMessage with +919876543210`;
const cleanErr = sanitizeError(rawErr);
assert(!cleanErr.includes('123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ'), 'Token must be redacted');
assert(!cleanErr.includes('9876543210'), 'Phone must be masked in sanitized error');
assert(cleanErr.includes('<REDACTED_BOT_TOKEN>') || cleanErr.includes('bot<REDACTED>'), 'Bot token placeholder present');

const discordRawErr = `Error at https://discord.com/api/webhooks/1234567890/tokenABC_123 : Invalid token`;
const discordCleanErr = sanitizeError(discordRawErr);
assert(!discordCleanErr.includes('tokenABC_123'), 'Discord webhook token must be redacted');
console.log('✓ Secret and error sanitization tests passed');

console.log('--- 3. Testing Message Formatting ---');

// Test A: High Urgency with complete summary
const highUrgencyPayload: NotifyPayload = {
  callId: 'call_test_1',
  businessName: 'Acme Plumbing',
  customerPhone: '+91 9876543210',
  endReason: 'completed',
  summary: {
    reason: 'Burst pipe flooding basement',
    urgency: 'high',
    preferred_time: 'Immediately',
    contact_details: '9876543210',
    suggested_action: 'Dispatch emergency crew now',
    short_summary: 'Customer has active flooding in basement.',
    sentiment: 'negative',
  },
};
const highMsg = formatCallNotification(highUrgencyPayload, 'http://localhost:3010');
assert(highMsg.startsWith('Missed-call callback: HIGH urgency'), 'Line 1 is HIGH urgency');
assert(highMsg.includes('Acme Plumbing · Customer: +91 ******3210'), 'Line 2 has business and masked phone');
assert(highMsg.includes('Reason: Burst pipe flooding basement'), 'Contains reason');
assert(highMsg.includes('Suggested action: Dispatch emergency crew now'), 'Contains suggested action');
assert(highMsg.includes('Sentiment: Negative'), 'Contains sentiment');
assert(highMsg.includes('View in dashboard: http://localhost:3010/?call=call_test_1'), 'Contains dashboard link');
console.log('✓ High urgency formatting passed');

// Test B: Opted Out (no summary fields)
const optOutPayload: NotifyPayload = {
  callId: 'call_test_2',
  businessName: 'Acme Plumbing',
  customerPhone: '+1 (555) 010-9999',
  endReason: 'opted_out',
  summary: null,
};
const optOutMsg = formatCallNotification(optOutPayload);
assert(optOutMsg.startsWith('Missed-call callback: OPTED OUT'), 'Line 1 is OPTED OUT');
assert(optOutMsg.includes('Customer opted out of callbacks and requested no further contact.'), 'Explains opted out status');
assert(!optOutMsg.includes('Reason:'), 'No reason field for opted out');
assert(!optOutMsg.includes('Sentiment:'), 'No sentiment field for opted out');
console.log('✓ Opted-out formatting passed');

// Test C: Error end reason
const errorPayload: NotifyPayload = {
  callId: 'call_test_3',
  businessName: 'Acme Plumbing',
  customerPhone: '+1 (555) 010-8888',
  endReason: 'error',
  summary: null,
};
const errorMsg = formatCallNotification(errorPayload);
assert(errorMsg.startsWith('Missed-call callback: ERROR'), 'Line 1 is ERROR');
assert(errorMsg.includes('Status: Call ended unexpectedly due to an error.'), 'Explains error status');
console.log('✓ Error end reason formatting passed');

// Test D: No answer
const noAnswerPayload: NotifyPayload = {
  callId: 'call_test_4',
  businessName: 'Acme Plumbing',
  customerPhone: '+1 (555) 010-7777',
  endReason: 'no_answer',
  summary: null,
};
const noAnswerMsg = formatCallNotification(noAnswerPayload);
assert(noAnswerMsg.startsWith('Missed-call callback: NO ANSWER'), 'Line 1 is NO ANSWER');
assert(noAnswerMsg.includes('Status: Call was not answered by the customer.'), 'Explains no answer');
console.log('✓ No-answer formatting passed');

// Test E: Special characters in customer text (< > & * _)
const specialPayload: NotifyPayload = {
  callId: 'call_test_5',
  businessName: 'Acme & Sons <Plumbing>',
  customerPhone: '+15550105555',
  endReason: 'completed',
  summary: {
    reason: 'Drain clog & leak with *urgent* need <script>alert(1)</script> and _italic_ text',
    urgency: 'medium',
    preferred_time: 'Tomorrow 9am & 11am',
    contact_details: 'me@example.com <John & Doe>',
    suggested_action: 'Call back *promptly* with price <= $200 & schedule',
    short_summary: 'Clog & leak',
    sentiment: 'neutral',
  },
};
const specialMsg = formatCallNotification(specialPayload);
assert(specialMsg.includes('<script>alert(1)</script>'), 'Special characters preserved as plain text without crashing');
assert(specialMsg.includes('&'), 'Ampersands preserved');
assert(specialMsg.includes('*urgent*'), 'Asterisks preserved without markdown destruction');
console.log('✓ Special characters plain text test passed');

// Test F: Very long fields with safe truncation and max length guarantee
const longText = 'A'.repeat(500);
const longPayload: NotifyPayload = {
  callId: 'call_test_6',
  businessName: 'Acme Plumbing',
  customerPhone: '+15550106666',
  endReason: 'completed',
  summary: {
    reason: longText,
    urgency: 'low',
    preferred_time: longText,
    contact_details: longText,
    suggested_action: longText,
    short_summary: longText,
    sentiment: 'neutral',
  },
};
const longMsg = formatCallNotification(longPayload);
assert(longMsg.length < 2000, `Message length ${longMsg.length} must be strictly < 2000 for Discord/Telegram`);
assert(longMsg.includes('...'), 'Long fields are truncated with ellipsis');
console.log('✓ Long fields truncation and limit test passed');

console.log('--- 4. Testing Provider Behavior & Safety ---');

// Test G: NOTIFY_PROVIDER=none is a complete no-op and never throws
process.env.NOTIFY_PROVIDER = 'none';
assert(getActiveProvider() === 'none', 'Active provider is none');

// Create a dummy call in SQLite to test notifyCallSummary
const testCallId = 'test_call_notify_' + Date.now();
db.prepare(`
  INSERT INTO calls (id, business_id, customer_phone, start_time, end_reason)
  VALUES (?, 'biz_1', '+15550101111', datetime('now'), 'completed')
`).run(testCallId);

// Test notify with provider=none
async function runSafetyTests() {
  await notifyCallSummary({
    callId: testCallId,
    businessName: 'Acme Plumbing',
    customerPhone: '+15550101111',
    endReason: 'completed',
    summary: { reason: 'Test leak', urgency: 'medium' },
  });

  const checkCall: any = db.prepare('SELECT notify_status FROM calls WHERE id=?').get(testCallId);
  assert(!checkCall.notify_status, 'With provider=none, notify_status remains null');
  console.log('✓ Provider=none is a safe no-op');

  // Test H: Provider failure does not throw and marks call as failed
  process.env.NOTIFY_PROVIDER = 'telegram';
  process.env.TELEGRAM_BOT_TOKEN = 'invalid_token_for_test';
  process.env.TELEGRAM_CHAT_ID = '12345';

  const failCallId = 'test_call_fail_' + Date.now();
  db.prepare(`
    INSERT INTO calls (id, business_id, customer_phone, start_time, end_reason)
    VALUES (?, 'biz_1', '+15550102222', datetime('now'), 'completed')
  `).run(failCallId);

  // Must NOT throw even with invalid network/credentials
  let threw = false;
  try {
    await notifyCallSummary({
      callId: failCallId,
      businessName: 'Acme Plumbing',
      customerPhone: '+15550102222',
      endReason: 'completed',
      summary: { reason: 'Test fail', urgency: 'high' },
    });
  } catch {
    threw = true;
  }
  assert(!threw, 'notifyCallSummary must never throw');

  const failedCallRecord: any = db.prepare('SELECT notify_status, notify_error FROM calls WHERE id=?').get(failCallId);
  assert(failedCallRecord.notify_status === 'failed', 'notify_status is set to failed');
  assert(Boolean(failedCallRecord.notify_error), 'notify_error is recorded in DB');
  assert(!failedCallRecord.notify_error.includes('invalid_token_for_test'), 'Secrets must not leak into notify_error');
  console.log('✓ Simulated failure caught, DB recorded failed status without leaking secrets');

  // Clean up test records
  db.prepare('DELETE FROM calls WHERE id IN (?, ?)').run(testCallId, failCallId);

  // Test I: sendTestNotification behavior
  process.env.NOTIFY_PROVIDER = 'none';
  const testNone = await sendTestNotification();
  assert(!testNone.ok && Boolean(testNone.error?.includes('none')), 'sendTestNotification returns error when provider is none');

  process.env.NOTIFY_PROVIDER = 'telegram';
  process.env.TELEGRAM_BOT_TOKEN = 'test_token';
  process.env.TELEGRAM_CHAT_ID = 'test_chat';
  const testTg = await sendTestNotification();
  assert(!testTg.ok, 'sendTestNotification fails gracefully with mock credentials');
  assert(!testTg.error?.includes('test_token'), 'sendTestNotification redacts token in error output');

  // Test J: resendCallNotification behavior
  process.env.NOTIFY_PROVIDER = 'none';
  const resendNone = await resendCallNotification('non_existent_call');
  assert(!resendNone.ok && Boolean(resendNone.error?.includes('none')), 'resend fails when provider is none');

  process.env.NOTIFY_PROVIDER = 'telegram';
  const resendNotFound = await resendCallNotification('non_existent_call');
  assert(!resendNotFound.ok && Boolean(resendNotFound.error?.includes('Call not found')), 'resend returns not found for missing call');
  console.log('✓ sendTestNotification and resendCallNotification tests passed');

  // Restore env
  process.env.NOTIFY_PROVIDER = 'none';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.DISCORD_WEBHOOK_URL;

  console.log('--- ALL NOTIFY TESTS PASSED SUCCESSFULLY ---');
}

runSafetyTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
