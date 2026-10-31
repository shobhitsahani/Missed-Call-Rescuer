import {
  maskPhoneNumber,
  sanitizeError,
  formatCallNotification,
  sendTestNotification,
  resendCallNotification,
  notifyCallSummary,
} from '../server/notify';
import db from '../server/db';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

async function verifyAll() {
  console.log('======================================================');
  console.log('VERIFYING OWNER NOTIFICATIONS IMPLEMENTATION');
  console.log('======================================================\n');

  // 1. Phone masking
  console.log('1. Checking Phone Masking across formats:');
  const samples = [
    { input: '+91 9876543210', expected: '+91 ******3210' },
    { input: '+1 (555) 010-1234', expected: '+1 ******1234' },
    { input: '+15550101234', expected: '+1 ******1234' },
    { input: '+44 7911 123456', expected: '+44 ******3456' },
    { input: 'unknown', expected: 'unknown' },
  ];
  for (const s of samples) {
    const masked = maskPhoneNumber(s.input);
    assert(masked === s.expected, `Masking ${s.input}: got ${masked}, expected ${s.expected}`);
    console.log(`   ${s.input} -> ${masked}`);
  }
  console.log('   ✓ Phone masking verified.\n');

  // 2. Secret Redaction
  console.log('2. Checking Token and Webhook Sanitization:');
  process.env.TELEGRAM_BOT_TOKEN = 'secret_bot_token_12345';
  process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/999/secret_webhook_token';
  const rawLeak = 'Error sending to https://api.telegram.org/botsecret_bot_token_12345/sendMessage and https://discord.com/api/webhooks/999/secret_webhook_token';
  const sanitized = sanitizeError(rawLeak);
  assert(!sanitized.includes('secret_bot_token_12345'), 'Bot token must be sanitized');
  assert(!sanitized.includes('secret_webhook_token'), 'Webhook token must be sanitized');
  console.log(`   Sanitized output: "${sanitized}"`);
  console.log('   ✓ Secret sanitization verified.\n');

  // 3. Message formatting with edge cases (< > & * _)
  console.log('3. Checking Plain-Text Formatter with edge cases:');
  const callPayload = {
    callId: 'call_verif_1',
    businessName: 'Acme Plumbing & Heating <LLC>',
    customerPhone: '+91 9876543210',
    endReason: 'completed',
    summary: {
      reason: 'Urgent *pipe burst* & leak <script>alert("test")</script>',
      urgency: 'high',
      preferred_time: 'Tomorrow 9am & 10am',
      contact_details: 'customer@example.com & +91 9876543210',
      suggested_action: 'Dispatch technician with part #1234 <= $50',
      short_summary: 'Flooding in basement',
      sentiment: 'negative',
    },
  };
  const msg = formatCallNotification(callPayload, 'http://localhost:3010');
  assert(msg.startsWith('Missed-call callback: HIGH urgency'), 'Must show HIGH urgency on line 1');
  assert(msg.includes('Customer: +91 ******3210'), 'Must mask middle digits in message body');
  assert(msg.includes('http://localhost:3010/?call=call_verif_1'), 'Must include direct link with ?call= query param');
  assert(msg.includes('<script>alert("test")</script>'), 'Preserves customer text without injecting');
  assert(msg.includes('&'), 'Preserves literal ampersands');
  console.log('--- Sample Generated Message: ---');
  console.log(msg);
  console.log('---------------------------------');
  console.log('   ✓ Plain text formatting verified.\n');

  // 4. Opted-out message formatting
  console.log('4. Checking Opted-Out Call Formatting:');
  const optOutMsg = formatCallNotification({
    callId: 'call_optout_1',
    businessName: 'Acme Plumbing',
    customerPhone: '+15550109999',
    endReason: 'opted_out',
    summary: null,
  });
  assert(optOutMsg.startsWith('Missed-call callback: OPTED OUT'), 'Must show OPTED OUT');
  assert(optOutMsg.includes('Customer opted out of callbacks and requested no further contact.'), 'Explains opted out status');
  console.log('   ✓ Opted-out message verified.\n');

  // 5. Provider none behavior
  console.log('5. Verifying NOTIFY_PROVIDER=none behavior:');
  process.env.NOTIFY_PROVIDER = 'none';
  const dummyCallId = 'call_none_test_' + Date.now();
  db.prepare(`
    INSERT INTO calls (id, business_id, customer_phone, start_time, end_reason)
    VALUES (?, 'biz_1', '+15550100001', datetime('now'), 'completed')
  `).run(dummyCallId);

  await notifyCallSummary({
    callId: dummyCallId,
    businessName: 'Acme Plumbing',
    customerPhone: '+15550100001',
    endReason: 'completed',
    summary: { reason: 'No-op test', urgency: 'low' },
  });

  const rowNone: any = db.prepare('SELECT notify_status FROM calls WHERE id=?').get(dummyCallId);
  assert(!rowNone.notify_status, 'notify_status must remain null when provider is none');
  console.log('   ✓ Provider=none is a safe no-op.\n');

  // 6. Non-blocking error resiliency & retry
  console.log('6. Verifying Non-blocking Failure Resiliency:');
  process.env.NOTIFY_PROVIDER = 'telegram';
  process.env.TELEGRAM_BOT_TOKEN = 'mock_bad_token';
  process.env.TELEGRAM_CHAT_ID = '999999';

  const failCallId = 'call_fail_test_' + Date.now();
  db.prepare(`
    INSERT INTO calls (id, business_id, customer_phone, start_time, end_reason)
    VALUES (?, 'biz_1', '+15550100002', datetime('now'), 'completed')
  `).run(failCallId);

  // Must not throw:
  await notifyCallSummary({
    callId: failCallId,
    businessName: 'Acme Plumbing',
    customerPhone: '+15550100002',
    endReason: 'completed',
    summary: { reason: 'Failure test', urgency: 'high' },
  });

  const rowFail: any = db.prepare('SELECT notify_status, notify_error FROM calls WHERE id=?').get(failCallId);
  assert(rowFail.notify_status === 'failed', 'Call record marked notify_status=failed');
  assert(Boolean(rowFail.notify_error), 'Call record has notify_error');
  assert(!rowFail.notify_error.includes('mock_bad_token'), 'No tokens leaked in DB notify_error');
  console.log(`   Recorded error in DB: "${rowFail.notify_error}"`);
  console.log('   ✓ Failure recorded safely without blocking call flow or leaking secrets.\n');

  // 7. Resend and Rate Limiting
  console.log('7. Verifying Resend Logic:');
  const resendResult = await resendCallNotification(failCallId);
  assert(!resendResult.ok, 'Resend with mock credentials fails gracefully');
  assert(Boolean(resendResult.error), 'Resend returns descriptive error message');
  console.log(`   Resend failure response: "${resendResult.error}"`);
  console.log('   ✓ Resend function verified.\n');

  // 8. Test notification
  console.log('8. Verifying Send Test Notification:');
  const testRes = await sendTestNotification();
  assert(!testRes.ok, 'Test with mock credentials reports error to UI');
  assert(!testRes.error?.includes('mock_bad_token'), 'Test error redacts secrets');
  console.log(`   Test notification error response: "${testRes.error}"`);
  console.log('   ✓ Test notification verified.\n');

  // Clean up
  db.prepare('DELETE FROM calls WHERE id IN (?, ?)').run(dummyCallId, failCallId);
  process.env.NOTIFY_PROVIDER = 'none';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.DISCORD_WEBHOOK_URL;

  console.log('======================================================');
  console.log('ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  console.log('======================================================');
}

verifyAll().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
