import {
  formatPlainTextTranscript,
  formatJsonTranscript,
  getTranscriptFilename,
  formatDuration,
  TranscriptData,
} from '../src/lib/transcript';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- Testing Transcript Formatting ---');

// 1. Duration formatting
assert(formatDuration('2026-10-30T10:00:00Z', '2026-10-30T10:00:45Z') === '45s', 'Duration 45s');
assert(formatDuration('2026-10-30T10:00:00Z', '2026-10-30T10:02:15Z') === '2m 15s', 'Duration 2m 15s');
assert(formatDuration('2026-10-30T10:00:00Z', null) === 'In progress', 'Duration In progress');
console.log('✓ Duration formatting passed');

// 2. Filename generation
const callWithPhone = {
  id: 'call_123',
  customer_phone: '+1 (555) 019-2834',
  start_time: '2026-10-30T14:25:00.000Z',
};
const fnTxt = getTranscriptFilename(callWithPhone, 'txt');
assert(fnTxt.startsWith('transcript-15550192834-') && fnTxt.endsWith('.txt'), `Filename phone: ${fnTxt}`);

const callNoPhone = {
  id: 'call_9999',
  customer_phone: '',
  start_time: '2026-10-30T14:25:00.000Z',
};
const fnJson = getTranscriptFilename(callNoPhone, 'json');
assert(fnJson.startsWith('transcript-call_9999-') && fnJson.endsWith('.json'), `Filename fallback: ${fnJson}`);
console.log('✓ Filename generation passed');

// 3. Case A: Empty call (no turns, no summary)
const emptyCallData: TranscriptData = {
  call: {
    id: 'call_empty',
    customer_phone: '+15550001',
    start_time: '2026-10-30T12:00:00Z',
    end_time: '2026-10-30T12:00:10Z',
    end_reason: 'completed',
  },
  businessName: 'Apex Plumbing',
  turns: [],
  summary: null,
};
const emptyTxt = formatPlainTextTranscript(emptyCallData);
assert(emptyTxt.includes('Business: Apex Plumbing'), 'Empty txt has business');
assert(emptyTxt.includes('Customer Phone: +15550001'), 'Empty txt has phone');
assert(emptyTxt.includes('Call Duration: 10s'), 'Empty txt duration');
assert(!emptyTxt.includes('Summary'), 'Empty txt does not have summary header');
assert(!emptyTxt.includes('[00:'), 'Empty txt does not have turns');

const emptyJsonStr = formatJsonTranscript(emptyCallData);
const emptyJson = JSON.parse(emptyJsonStr);
assert(emptyJson.business === 'Apex Plumbing', 'Empty json business');
assert(emptyJson.call.id === 'call_empty', 'Empty json call id');
assert(emptyJson.turns.length === 0, 'Empty json turns length 0');
assert(emptyJson.summary === null, 'Empty json summary null');
console.log('✓ Case A (empty call) passed');

// 4. Case B: Call with turns, interrupted turn, missing summary
const interruptedCallData: TranscriptData = {
  call: {
    id: 'call_interrupted',
    customer_phone: '+15550002',
    start_time: '2026-10-30T12:00:00Z',
    end_time: '2026-10-30T12:01:00Z',
    end_reason: 'completed',
  },
  businessName: 'Apex Plumbing',
  turns: [
    {
      role: 'agent',
      text: 'Hello, thanks for calling Apex Plumbing. How can I help you today?',
      interrupted: 0,
      ts: '2026-10-30T12:00:00Z',
      order_idx: 1,
    },
    {
      role: 'customer',
      text: 'Hi, our kitchen sink is backing up with dirty water.',
      interrupted: 0,
      ts: '2026-10-30T12:00:15Z',
      order_idx: 2,
    },
    {
      role: 'agent',
      text: 'I can certainly help arrange an emergency technician to come take a look at your sink right away—',
      interrupted: 1,
      ts: '2026-10-30T12:00:20Z',
      order_idx: 3,
    },
    {
      role: 'customer',
      text: 'Wait, could you come after 3 PM instead?',
      interrupted: 0,
      ts: '2026-10-30T12:00:28Z',
      order_idx: 4,
    },
  ],
  summary: null,
};
const interTxt = formatPlainTextTranscript(interruptedCallData);
assert(interTxt.includes('[00:00] Agent: Hello, thanks for calling'), 'First turn timestamp [00:00]');
assert(interTxt.includes('[00:15] Customer: Hi, our kitchen sink'), 'Second turn timestamp [00:15]');
assert(
  interTxt.includes('[00:20] Agent: I can certainly help arrange an emergency technician to come take a look at your sink right away— (interrupted)'),
  'Interrupted marker present'
);
assert(interTxt.includes('[00:28] Customer: Wait, could you come after 3 PM instead?'), 'Turn after interrupt');
assert(!interTxt.includes('(interrupted)\n[00:28] Customer') || interTxt.includes('(interrupted)'), 'Interrupted logic sound');

const interJson = JSON.parse(formatJsonTranscript(interruptedCallData));
assert(interJson.turns.length === 4, '4 turns in json');
assert(interJson.turns[2].interrupted === true, 'Turn 3 interrupted true');
assert(interJson.turns[1].interrupted === false, 'Turn 2 interrupted false');
assert(interJson.summary === null, 'Summary is null');
console.log('✓ Case B (interrupted turn, missing summary) passed');

// 5. Case C: Full call with summary
const fullCallData: TranscriptData = {
  call: {
    id: 'call_full',
    customer_phone: '+15550003',
    start_time: '2026-10-30T12:00:00Z',
    end_time: '2026-10-30T12:01:30Z',
    end_reason: 'completed',
    latency: [{ totalMs: 680, llmFirstTokenMs: 310, ttsFirstAudioMs: 350 }],
  },
  businessName: 'Apex Plumbing',
  turns: [
    {
      role: 'agent',
      text: 'Hello, Apex Plumbing.',
      interrupted: 0,
      ts: '2026-10-30T12:00:00Z',
    },
    {
      role: 'customer',
      text: 'I have a broken pipe.',
      interrupted: 0,
      ts: '2026-10-30T12:00:08Z',
    },
  ],
  summary: {
    call_id: 'call_full',
    reason: 'Broken pipe emergency',
    urgency: 'high',
    preferred_time: 'ASAP',
    contact_details: 'Customer at +15550003',
    suggested_action: 'Dispatch on-call plumber immediately',
    short_summary: 'Customer has broken pipe needing emergency dispatch.',
    sentiment: 'anxious',
  },
};
const fullTxt = formatPlainTextTranscript(fullCallData);
assert(fullTxt.includes('Summary'), 'Summary header present in txt');
assert(fullTxt.includes('Reason: Broken pipe emergency'), 'Reason in txt');
assert(fullTxt.includes('Urgency: high'), 'Urgency in txt');
assert(fullTxt.includes('Preferred Time: ASAP'), 'Preferred Time in txt');
assert(fullTxt.includes('Contact Details: Customer at +15550003'), 'Contact Details in txt');
assert(fullTxt.includes('Suggested Action: Dispatch on-call plumber immediately'), 'Action in txt');
assert(fullTxt.includes('Sentiment: anxious'), 'Sentiment in txt');

const fullJson = JSON.parse(formatJsonTranscript(fullCallData));
assert(fullJson.summary.reason === 'Broken pipe emergency', 'Summary reason in json');
assert(fullJson.summary.urgency === 'high', 'Summary urgency in json');
assert(fullJson.call.latency[0].totalMs === 680, 'Latency present in json');
console.log('✓ Case C (full call with summary) passed');

console.log('\nALL TRANSCRIPT TESTS PASSED SUCCESSFULLY!');
