import assert from 'assert';

const BASE = process.env.API_BASE || 'http://localhost:4000';

async function json(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  assert(res.ok, `${path} returned ${res.status}`);
  return res.json();
}

async function main() {
  console.log('--- Settings Persistence & Voice Preview Verification ---');
  const original = await json('/api/business');
  assert(typeof original.name === 'string' && original.name.length > 0, 'Business name missing');
  assert(!Object.prototype.hasOwnProperty.call(original, 'owner_email'), 'owner_email must not be public');

  const modifiedTone = `${original.tone || 'friendly'} [e2e-check]`;
  const putBody = {
    name: original.name,
    hours: original.hours || '',
    services: original.services || [],
    faqs: original.faqs || [],
    tone: modifiedTone,
    voice: original.voice || 'aai-jane',
    timezone: original.timezone || 'Asia/Kolkata',
  };

  try {
    const put = await fetch(`${BASE}/api/business`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody),
    });
    assert(put.ok, `PUT /api/business returned ${put.status}`);
    const saved = await put.json();
    assert(saved.tone === modifiedTone, 'PUT response did not reflect saved tone');

    const reloaded = await json('/api/business');
    assert(reloaded.tone === modifiedTone, 'Settings did not persist across GET');
    console.log('✓ Settings save + reload persistence works.');
  } finally {
    const restore = await fetch(`${BASE}/api/business`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...putBody, tone: original.tone || '' }),
    });
    assert(restore.ok, `Restore PUT returned ${restore.status}`);
  }

  const restored = await json('/api/business');
  assert((restored.tone || '') === (original.tone || ''), 'Original tone was not restored');
  console.log('✓ Original settings restored.');

  const preview = await fetch(`${BASE}/api/business/voice-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceId: restored.voice || 'aai-jane' }),
  });
  const audio = Buffer.from(await preview.arrayBuffer());
  assert(preview.ok, `voice-preview returned ${preview.status}: ${audio.toString('utf8').slice(0, 200)}`);
  assert((preview.headers.get('content-type') || '').includes('audio/wav'), 'Expected audio/wav content type');
  assert(audio.length > 1000, `Expected non-trivial WAV audio, got ${audio.length} bytes`);
  assert(audio.slice(0, 4).toString('ascii') === 'RIFF', 'WAV must start with RIFF header');
  console.log(`✓ Live AssemblyAI voice preview returned ${audio.length} bytes of WAV audio.`);
}

main().catch((err) => {
  console.error('Settings/voice verification failed:', err);
  process.exit(1);
});
