import db from '../server/db';
import { computeAverages } from '../src/lib/useDashboardData';
import { v4 as uuidv4 } from 'uuid';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

console.log('=== Running Latency Pipeline & Metric Regression Suite ===\n');

// -------------------------------------------------------------
// PART 1: Frontend Latency Extraction and computeAverages Tests
// -------------------------------------------------------------
console.log('--- 1. Testing Frontend computeAverages & Parser Robustness ---');

// 1.1 Empty / null input
assert(computeAverages([]) === null, 'Empty array must return null');
assert(computeAverages(undefined as unknown as []) === null, 'Undefined must return null');

// 1.2 Valid numeric items
const standardMetrics = [
  { totalMs: 1800, llmFirstTokenMs: 1400, ttsFirstAudioMs: 400, turnDetectionMs: 250 },
  { totalMs: 1600, llmFirstTokenMs: 1200, ttsFirstAudioMs: 400, turnDetectionMs: 300 },
];
const standardAvg = computeAverages(standardMetrics);
assert(standardAvg !== null, 'Valid metrics must produce averages');
assert(standardAvg?.avgTotal === 1700, `Expected avgTotal 1700, got ${standardAvg?.avgTotal}`);
assert(standardAvg?.avgLlm === 1300, `Expected avgLlm 1300, got ${standardAvg?.avgLlm}`);
assert(standardAvg?.avgTts === 400, `Expected avgTts 400, got ${standardAvg?.avgTts}`);
assert(standardAvg?.avgTurn === 275, `Expected avgTurn 275, got ${standardAvg?.avgTurn}`);
console.log('✓ Standard numeric metric objects compute correct averages');

// 1.3 Handling numeric strings from API contracts
const stringMetrics = [
  { totalMs: '1850', llmFirstTokenMs: '1450', ttsFirstAudioMs: '400', turnDetectionMs: '200' },
  { totalMs: '1650', llmFirstTokenMs: '1250', ttsFirstAudioMs: '400', turnDetectionMs: '300' },
];
const stringAvg = computeAverages(stringMetrics as unknown as any);
assert(stringAvg !== null, 'Numeric strings must be parsed cleanly');
assert(stringAvg?.avgTotal === 1750, `Expected avgTotal 1750, got ${stringAvg?.avgTotal}`);
assert(stringAvg?.avgLlm === 1350, `Expected avgLlm 1350, got ${stringAvg?.avgLlm}`);
console.log('✓ Numeric strings from API contract are parsed without data loss');

// 1.4 Rejecting negative, zero, NaN, and non-finite numbers
const dirtyMetrics = [
  { totalMs: -500, llmFirstTokenMs: -100, ttsFirstAudioMs: 0 },
  { totalMs: 0, llmFirstTokenMs: 0, ttsFirstAudioMs: 0 },
  { totalMs: NaN, llmFirstTokenMs: NaN, ttsFirstAudioMs: NaN },
  { totalMs: Infinity, llmFirstTokenMs: Infinity, ttsFirstAudioMs: Infinity },
  { totalMs: 1500, llmFirstTokenMs: 1100, ttsFirstAudioMs: 400 },
];
const dirtyAvg = computeAverages(dirtyMetrics as unknown as any);
assert(dirtyAvg !== null, 'Should extract single valid measurement from dirty list');
assert(dirtyAvg?.avgTotal === 1500, `Expected 1500, got ${dirtyAvg?.avgTotal}`);
assert(dirtyAvg?.avgLlm === 1100, `Expected 1100, got ${dirtyAvg?.avgLlm}`);
assert(dirtyAvg?.avgTts === 400, `Expected 400, got ${dirtyAvg?.avgTts}`);
console.log('✓ Negative, zero, NaN, and non-finite values are safely rejected');

// 1.5 Legacy scalar numbers
const scalarMetrics = [1400, 1600];
const scalarAvg = computeAverages(scalarMetrics);
assert(scalarAvg?.avgTotal === 1500, `Expected scalar avg 1500, got ${scalarAvg?.avgTotal}`);
console.log('✓ Legacy scalar numbers array correctly parsed');

// -------------------------------------------------------------
// PART 2: Chart Data Ordering & State Discrimination
// -------------------------------------------------------------
console.log('\n--- 2. Testing Chart Data Chronological Ordering & State Rules ---');

// Mock calls with varying latency states
const mockThreeEmptyCalls = [
  { id: 'call_1', start_time: '2026-11-02T10:00:00Z', latency: [] },
  { id: 'call_2', start_time: '2026-11-02T10:05:00Z', latency: [] },
  { id: 'call_3', start_time: '2026-11-02T10:10:00Z', latency: [] },
];

function extractChartPoints(calls: Array<{ id: string; start_time: string; latency: any[] }>) {
  interface LatencyPoint {
    callId: string;
    label: string;
    timestamp: number;
    total: number;
  }
  const points: LatencyPoint[] = [];
  for (const c of calls) {
    if (!Array.isArray(c.latency) || c.latency.length === 0) continue;
    const totals: number[] = [];
    for (const item of c.latency) {
      const tot = typeof item === 'number'
        ? item
        : typeof item === 'string'
          ? Number(item)
          : (item && typeof item === 'object')
            ? (typeof item.totalMs === 'number' ? item.totalMs : Number(item.totalMs))
            : null;
      if (tot !== null && Number.isFinite(tot) && tot > 0) totals.push(tot);
    }
    if (totals.length > 0) {
      const avg = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
      const d = new Date(c.start_time);
      points.push({
        callId: c.id.slice(0, 6),
        label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: d.getTime(),
        total: avg,
      });
    }
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  return points.slice(-10);
}

// Case A: Three calls with no latency
const pointsEmpty = extractChartPoints(mockThreeEmptyCalls);
assert(pointsEmpty.length === 0, 'Three calls without speech must yield 0 chart points');
console.log('✓ Three calls without speech correctly produce 0 chart points (triggers calls-without-latency state)');

// Case B: Exactly one call with latency
const mockOneValidCall = [
  ...mockThreeEmptyCalls,
  { id: 'call_4', start_time: '2026-11-02T10:15:00Z', latency: [{ totalMs: 1680, llmFirstTokenMs: 1300, ttsFirstAudioMs: 380 }] },
];
const pointsOne = extractChartPoints(mockOneValidCall);
assert(pointsOne.length === 1, 'Exactly one measurement must be extracted');
assert(pointsOne[0].total === 1680, `Expected 1680, got ${pointsOne[0].total}`);
console.log('✓ Exactly one valid measurement correctly extracted (triggers single-observation state)');

// Case C: Multiple calls out of chronological order
const mockMultipleCallsUnsorted = [
  { id: 'call_c', start_time: '2026-11-02T10:30:00Z', latency: [{ totalMs: 1800 }] },
  { id: 'call_a', start_time: '2026-11-02T10:10:00Z', latency: [{ totalMs: 1500 }] },
  { id: 'call_b', start_time: '2026-11-02T10:20:00Z', latency: [{ totalMs: 1650 }] },
];
const pointsSorted = extractChartPoints(mockMultipleCallsUnsorted);
assert(pointsSorted.length === 3, 'All 3 valid points must be extracted');
assert(pointsSorted[0].callId === 'call_a' && pointsSorted[0].total === 1500, 'Earliest call must be first');
assert(pointsSorted[1].callId === 'call_b' && pointsSorted[1].total === 1650, 'Middle call must be second');
assert(pointsSorted[2].callId === 'call_c' && pointsSorted[2].total === 1800, 'Latest call must be third');
console.log('✓ Unsorted calls correctly ordered chronologically ascending');

// -------------------------------------------------------------
// PART 3: SQLite Database Persistence & API Consistency
// -------------------------------------------------------------
console.log('\n--- 3. Testing SQLite Persistence & Call Lifecycle Invariants ---');

const testBizId = 'biz_test_' + uuidv4().slice(0, 8);
db.prepare('INSERT OR IGNORE INTO businesses (id, name, hours, services, faqs, tone, voice, timezone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run(testBizId, 'Test Plumbing', '9-5', '[]', '[]', 'neutral', 'aai-jane', 'UTC');

const testCallId = uuidv4();
const startTime = new Date().toISOString();

// Insert a call record
db.prepare('INSERT INTO calls (id, business_id, customer_phone, start_time, latency_json, usage_json) VALUES (?, ?, ?, ?, ?, ?)')
  .run(testCallId, testBizId, '+15550199', startTime, '[]', '{}');

// Simulate turn measurement arrival
const recordedTurnLatency = [
  { totalMs: 1754, llmFirstTokenMs: 1380, ttsFirstAudioMs: 374, turnDetectionMs: 250 },
];
db.prepare('UPDATE calls SET latency_json=? WHERE id=?')
  .run(JSON.stringify(recordedTurnLatency), testCallId);

// Verify immediate persistence
const fetched1 = db.prepare('SELECT latency_json FROM calls WHERE id=?').get(testCallId) as { latency_json: string };
const parsed1 = JSON.parse(fetched1.latency_json);
assert(Array.isArray(parsed1) && parsed1.length === 1, 'Turn latency must be persisted');
assert(parsed1[0].totalMs === 1754, `Expected totalMs 1754, got ${parsed1[0].totalMs}`);
console.log('✓ Measurement persisted immediately to database');

// Verify subsequent status updates preserve recorded latency
db.prepare('UPDATE calls SET notified_at=?, notify_status=?, notify_provider=? WHERE id=?')
  .run(new Date().toISOString(), 'sent', 'test_provider', testCallId);

const fetched2 = db.prepare('SELECT latency_json, notify_status FROM calls WHERE id=?').get(testCallId) as { latency_json: string; notify_status: string };
assert(fetched2.notify_status === 'sent', 'Notification status must update');
const parsed2 = JSON.parse(fetched2.latency_json);
assert(parsed2[0].totalMs === 1754, 'Notification status update must not overwrite latency');
console.log('✓ Subsequent call status update preserves recorded latency');

// Verify call termination preserves latency
db.prepare('UPDATE calls SET end_time=?, end_reason=? WHERE id=?')
  .run(new Date().toISOString(), 'user_ended', testCallId);

const fetched3 = db.prepare('SELECT latency_json, end_reason FROM calls WHERE id=?').get(testCallId) as { latency_json: string; end_reason: string };
assert(fetched3.end_reason === 'user_ended', 'End reason must be recorded');
const parsed3 = JSON.parse(fetched3.latency_json);
assert(parsed3[0].totalMs === 1754, 'Call termination preserves recorded latency');
console.log('✓ Call termination preserves recorded latency');

// Clean up test call
db.prepare('DELETE FROM calls WHERE id=?').run(testCallId);
db.prepare('DELETE FROM businesses WHERE id=?').run(testBizId);

console.log('\n=============================================================');
console.log('🎉 ALL LATENCY PIPELINE & METRIC REGRESSION TESTS PASSED!');
console.log('=============================================================');
