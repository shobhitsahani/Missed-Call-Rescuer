
async function runTests() {
  const base = process.env.API_BASE || 'http://localhost:4000';
  console.log(`Running settings validation tests against ${base}...`);

  // 1. GET /api/business
  const getRes = await fetch(`${base}/api/business`);
  if (!getRes.ok) throw new Error(`GET /api/business failed: ${getRes.status}`);
  const biz = await getRes.json();
  console.log('✓ GET /api/business returns parsed business:', biz.name, biz.voice, biz.timezone);

  // 2. GET /api/business/voices
  const voicesRes = await fetch(`${base}/api/business/voices`);
  if (!voicesRes.ok) throw new Error(`GET /api/business/voices failed: ${voicesRes.status}`);
  const voicesData = await voicesRes.json();
  if (!Array.isArray(voicesData.voices) || voicesData.voices.length < 10) {
    throw new Error('Voices catalog is missing or incomplete');
  }
  console.log(`✓ GET /api/business/voices returns ${voicesData.voices.length} voices`);

  // 3. Validation: Reject empty name
  const emptyNameRes = await fetch(`${base}/api/business`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '   ', voice: 'aai-jane', timezone: 'Asia/Kolkata' }),
  });
  if (emptyNameRes.status !== 400) throw new Error(`Expected 400 for empty name, got ${emptyNameRes.status}`);
  const emptyNameData = await emptyNameRes.json();
  if (!emptyNameData.errors?.name) throw new Error('Expected field error for name');
  console.log('✓ Rejected empty business name with field error:', emptyNameData.errors.name);

  // 4. Validation: Reject invalid voice
  const badVoiceRes = await fetch(`${base}/api/business`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Valid Name', voice: 'unsupported-voice-123', timezone: 'Asia/Kolkata' }),
  });
  if (badVoiceRes.status !== 400) throw new Error(`Expected 400 for bad voice, got ${badVoiceRes.status}`);
  const badVoiceData = await badVoiceRes.json();
  if (!badVoiceData.errors?.voice) throw new Error('Expected field error for voice');
  console.log('✓ Rejected invalid voice ID with field error:', badVoiceData.errors.voice);

  // 5. Validation: Reject invalid timezone
  const badTzRes = await fetch(`${base}/api/business`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Valid Name', voice: 'aai-jane', timezone: 'Invalid/Zone' }),
  });
  if (badTzRes.status !== 400) throw new Error(`Expected 400 for bad timezone, got ${badTzRes.status}`);
  const badTzData = await badTzRes.json();
  if (!badTzData.errors?.timezone) throw new Error('Expected field error for timezone');
  console.log('✓ Rejected invalid timezone with field error:', badTzData.errors.timezone);

  // 6. Validation: Reject > 20 services
  const tooManyServices = Array.from({ length: 25 }, (_, i) => `Service ${i}`);
  const badServicesRes = await fetch(`${base}/api/business`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Valid Name', voice: 'aai-jane', timezone: 'Asia/Kolkata', services: tooManyServices }),
  });
  if (badServicesRes.status !== 400) throw new Error(`Expected 400 for too many services`);
  console.log('✓ Rejected > 20 services list');

  // 7. Reset to default
  const resetRes = await fetch(`${base}/api/business/reset`, { method: 'POST' });
  if (!resetRes.ok) throw new Error(`Reset failed: ${resetRes.status}`);
  const resetData = await resetRes.json();
  if (resetData.business.name !== 'Acme Plumbing') throw new Error('Reset failed to restore Acme Plumbing');
  console.log('✓ Reset restored Acme Plumbing defaults');

  console.log('ALL SETTINGS VALIDATION TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
