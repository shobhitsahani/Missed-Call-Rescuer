import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import {
  resendCallNotification,
  sendTestNotification,
  getActiveProvider,
} from './notify';
import cors from 'cors';
import db, { parseServices, parseFaqs, DEFAULT_BIZ } from './db';
import * as events from './events';
import * as sessionModule from './session';
import { ASSEMBLYAI_VOICES, VALID_VOICE_IDS, isValidVoiceId } from '../src/lib/voices';
import { TtsClient } from './tts';
import { pcmToWav } from './wav';
import {
  formatPlainTextTranscript,
  formatJsonTranscript,
  getTranscriptFilename,
} from '../src/lib/transcript';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

app.get('/api/business', (_req, res) => {
  const b = db.prepare('SELECT * FROM businesses LIMIT 1').get() as any;
  if (!b) return res.status(404).json({ error: 'Business config not found' });
  res.json({
    ...b,
    services: parseServices(b.services),
    faqs: parseFaqs(b.faqs),
    timezone: b.timezone || 'Asia/Kolkata',
    voice: b.voice || 'aai-jane',
  });
});

app.get('/api/business/voices', (_req, res) => {
  res.json({ voices: ASSEMBLYAI_VOICES });
});

const previewRateLimits = new Map<string, number>();

app.post('/api/business/voice-preview', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'global';
  const now = Date.now();
  const last = previewRateLimits.get(ip) || 0;
  if (now - last < 1500) {
    return res.status(429).json({ error: 'Too many preview requests. Please wait a moment.' });
  }
  previewRateLimits.set(ip, now);

  const { voiceId } = req.body || {};
  if (!voiceId || !isValidVoiceId(voiceId)) {
    return res.status(400).json({ error: 'Invalid voice ID.' });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY || '';
  if (!apiKey) {
    return res.status(503).json({ error: 'AssemblyAI API key not configured on server.' });
  }

  try {
    const tts = new TtsClient({
      apiKey,
      voiceId,
      sampleRate: 24000,
      encoding: 'pcm_s16le',
      language: 'english',
    });

    const previewText = 'Hi, this is a voice sample from Missed-Call Rescuer.';
    const chunks: Buffer[] = [];

    for await (const chunk of tts.speak(previewText)) {
      chunks.push(Buffer.from(chunk));
    }

    await tts.close().catch(() => {});

    if (chunks.length === 0) {
      return res.status(502).json({ error: 'No audio returned from voice synthesis.' });
    }

    const pcmBuffer = Buffer.concat(chunks);
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', wavBuffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(wavBuffer);
  } catch (err: any) {
    console.error('Voice preview error:', err?.message);
    return res.status(502).json({ error: err?.message || 'Voice synthesis preview failed.' });
  }
});

app.put('/api/business', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object.' });
  }

  const errors: Record<string, string> = {};

  // Validate name
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    errors.name = 'Business name is required.';
  } else if (name.length > 100) {
    errors.name = 'Business name must not exceed 100 characters.';
  }

  // Validate hours
  const hours = typeof body.hours === 'string' ? body.hours.trim() : '';
  if (hours.length > 200) {
    errors.hours = 'Opening hours must not exceed 200 characters.';
  }

  // Validate services
  let services = body.services;
  if (services === undefined || services === null) {
    services = [];
  }
  if (!Array.isArray(services)) {
    errors.services = 'Services must be a list of strings.';
  } else if (services.length > 20) {
    errors.services = 'At most 20 services are allowed.';
  } else {
    for (let i = 0; i < services.length; i++) {
      const s = typeof services[i] === 'string' ? services[i].trim() : '';
      if (!s) {
        errors.services = `Service item #${i + 1} cannot be empty.`;
        break;
      }
      if (s.length > 80) {
        errors.services = `Service item #${i + 1} exceeds 80 characters.`;
        break;
      }
    }
  }

  // Validate FAQs
  let faqs = body.faqs;
  if (faqs === undefined || faqs === null) {
    faqs = [];
  }
  if (!Array.isArray(faqs)) {
    errors.faqs = 'FAQs must be a list of question and answer pairs.';
  } else if (faqs.length > 20) {
    errors.faqs = 'At most 20 FAQs are allowed.';
  } else {
    for (let i = 0; i < faqs.length; i++) {
      const item = faqs[i];
      if (!item || typeof item !== 'object') {
        errors.faqs = `FAQ item #${i + 1} must be an object with question and answer.`;
        break;
      }
      const q = typeof item.question === 'string' ? item.question.trim() : '';
      const a = typeof item.answer === 'string' ? item.answer.trim() : '';
      if (!q || !a) {
        errors.faqs = `FAQ #${i + 1} must have both a question and an answer.`;
        break;
      }
      if (q.length > 120) {
        errors.faqs = `FAQ #${i + 1} question exceeds 120 characters.`;
        break;
      }
      if (a.length > 250) {
        errors.faqs = `FAQ #${i + 1} answer exceeds 250 characters.`;
        break;
      }
    }
  }

  // Validate tone
  const tone = typeof body.tone === 'string' ? body.tone.trim() : '';
  if (tone.length > 100) {
    errors.tone = 'Tone must not exceed 100 characters.';
  }

  // Validate voice
  const voice = typeof body.voice === 'string' ? body.voice.trim() : '';
  if (!voice || !isValidVoiceId(voice)) {
    errors.voice = 'Please select a valid voice from the available list.';
  }

  // Validate timezone
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : '';
  if (!timezone || !isValidTimezone(timezone)) {
    errors.timezone = 'Please specify a valid IANA timezone (e.g. Asia/Kolkata, America/New_York).';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ errors });
  }

  const cleanedServices = (services as string[]).map((s: string) => s.trim());
  const cleanedFaqs = (faqs as Array<{ question: string; answer: string }>).map((f: { question: string; answer: string }) => ({
    question: f.question.trim(),
    answer: f.answer.trim(),
  }));

  const existingBiz = db.prepare('SELECT id FROM businesses LIMIT 1').get() as any;
  const bizId = existingBiz?.id || DEFAULT_BIZ.id;

  db.prepare(`UPDATE businesses SET name=?, hours=?, services=?, faqs=?, tone=?, voice=?, timezone=? WHERE id=?`)
    .run(
      name,
      hours,
      JSON.stringify(cleanedServices),
      JSON.stringify(cleanedFaqs),
      tone,
      voice,
      timezone,
      bizId
    );

  const updated = db.prepare('SELECT * FROM businesses WHERE id=?').get(bizId) as any;
  return res.json({
    ...updated,
    services: cleanedServices,
    faqs: cleanedFaqs,
    timezone: updated.timezone || timezone,
  });
});

app.post('/api/business/reset', (_req, res) => {
  const existingBiz = db.prepare('SELECT id FROM businesses LIMIT 1').get() as any;
  const bizId = existingBiz?.id || DEFAULT_BIZ.id;

  db.prepare(`UPDATE businesses SET name=?, hours=?, services=?, faqs=?, tone=?, voice=?, language=?, timezone=? WHERE id=?`)
    .run(
      DEFAULT_BIZ.name,
      DEFAULT_BIZ.hours,
      DEFAULT_BIZ.services,
      DEFAULT_BIZ.faqs,
      DEFAULT_BIZ.tone,
      DEFAULT_BIZ.voice,
      DEFAULT_BIZ.language,
      DEFAULT_BIZ.timezone,
      bizId
    );

  res.json({
    ok: true,
    business: {
      ...DEFAULT_BIZ,
      services: parseServices(DEFAULT_BIZ.services),
      faqs: parseFaqs(DEFAULT_BIZ.faqs),
    },
  });
});

app.get('/api/missed-calls', (_req, res) => {
  const rows = db.prepare('SELECT * FROM missed_calls ORDER BY time DESC').all();
  res.json(rows);
});

app.post('/api/missed-calls/simulate', (req, res) => {
  const { phone } = req.body || {};
  const id = 'mc_' + Date.now();
  const business: any = db.prepare('SELECT id FROM businesses LIMIT 1').get();
  const phoneNumber = phone || '+1 (555) 010-' + Math.floor(1000 + Math.random() * 9000);
  db.prepare('INSERT INTO missed_calls (id, business_id, customer_phone, time, status) VALUES (?,?,?,?,?)')
    .run(id, business.id, phoneNumber, new Date().toISOString(), 'new');
  const jobId = 'job_' + Date.now();
  db.prepare('INSERT INTO callback_jobs (id, missed_call_id, attempts, schedule, state) VALUES (?,?,?,?,?)')
    .run(jobId, id, 0, new Date().toISOString(), 'queued');
  db.prepare('UPDATE missed_calls SET status=? WHERE id=?').run('queued', id);
  events.broadcast('missed_call', { id, customer_phone: phoneNumber });
  res.json({ missedCallId: id, jobId });
});

app.get('/api/calls', (_req, res) => {
  const rows = db.prepare('SELECT * FROM calls ORDER BY start_time DESC').all();
  res.json(rows.map((r: any) => ({ ...r, latency: r.latency_json ? JSON.parse(r.latency_json) : [], usage: r.usage_json ? JSON.parse(r.usage_json) : {} })));
});

app.get('/api/calls/:id', (req, res) => {
  const call = db.prepare('SELECT * FROM calls WHERE id=?').get(req.params.id);
  if (!call) return res.status(404).json({ error: 'not found' });
  const turns = db.prepare('SELECT * FROM turns WHERE call_id=? ORDER BY order_idx').all(req.params.id);
  const summary = db.prepare('SELECT * FROM summaries WHERE call_id=?').get(req.params.id);
  res.json({ call: { ...call, latency: (call as any).latency_json ? JSON.parse((call as any).latency_json) : [], usage: (call as any).usage_json ? JSON.parse((call as any).usage_json) : {} }, turns, summary });
});

app.get('/api/calls/:id/transcript', (req, res) => {
  const format = String(req.query.format || 'txt').toLowerCase();
  if (format !== 'txt' && format !== 'json') {
    return res.status(400).json({ error: 'Invalid format. Use "txt" or "json".' });
  }

  const call: any = db.prepare('SELECT * FROM calls WHERE id=?').get(req.params.id);
  if (!call) return res.status(404).json({ error: 'not found' });

  const turns: any = db.prepare('SELECT * FROM turns WHERE call_id=? ORDER BY order_idx').all(req.params.id);
  const summary: any = db.prepare('SELECT * FROM summaries WHERE call_id=?').get(req.params.id);
  const business: any = db.prepare('SELECT name FROM businesses LIMIT 1').get();

  const parsedCall = {
    ...call,
    latency: call.latency_json ? JSON.parse(call.latency_json) : [],
    usage: call.usage_json ? JSON.parse(call.usage_json) : {},
  };

  const filename = getTranscriptFilename(parsedCall, format as 'txt' | 'json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const content = formatJsonTranscript({
      call: parsedCall,
      businessName: business?.name,
      turns,
      summary,
    });
    return res.send(content);
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const content = formatPlainTextTranscript({
      call: parsedCall,
      businessName: business?.name,
      turns,
      summary,
    });
    return res.send(content);
  }
});

app.get('/api/summaries/:callId', (req, res) => {
  const s = db.prepare('SELECT * FROM summaries WHERE call_id=?').get(req.params.callId);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  events.addClient(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
});

const resendTimestamps = new Map<string, number>();

app.post('/api/notify/test', async (_req, res) => {
  const provider = getActiveProvider();
  if (provider === 'none') {
    return res.status(400).json({
      ok: false,
      error: 'No notification provider configured (NOTIFY_PROVIDER=none).',
      provider: 'none',
    });
  }

  const result = await sendTestNotification();
  if (!result.ok) {
    return res.status(400).json({
      ok: false,
      error: result.error || 'Failed to send test notification',
      provider: result.provider,
    });
  }

  res.json({
    ok: true,
    provider: result.provider,
    message: 'Test notification sent successfully',
  });
});

app.post('/api/calls/:id/notify', async (req, res) => {
  const callId = req.params.id;
  const call = db.prepare('SELECT id FROM calls WHERE id=?').get(callId);
  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }

  const provider = getActiveProvider();
  if (provider === 'none') {
    return res.status(400).json({
      error: 'No notification provider configured (NOTIFY_PROVIDER=none).',
    });
  }

  const lastResend = resendTimestamps.get(callId);
  const now = Date.now();
  if (lastResend && now - lastResend < 30000) {
    const remainingSec = Math.ceil((30000 - (now - lastResend)) / 1000);
    return res.status(429).json({
      error: `Rate limited. Please wait ${remainingSec}s before resending.`,
    });
  }

  resendTimestamps.set(callId, now);

  const result = await resendCallNotification(callId);
  if (!result.ok) {
    return res.status(500).json({
      ok: false,
      error: result.error || 'Notification failed',
      provider: result.provider,
    });
  }

  res.json({
    ok: true,
    provider: result.provider,
    notified_at: result.notified_at,
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  let session: any = null;
  ws.on('message', async (data, isBinary) => {
    if (isBinary) return;
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (msg.type === 'join') {
      try {
        session = await sessionModule.startSession(ws, msg.missedCallId);
      } catch (e: any) {
        ws.send(JSON.stringify({ type: 'error', message: e?.message }));
      }
      return;
    }
    if (!session) return;
    if (msg.type === 'transcript' && msg.final) {
      await sessionModule.handleCustomerUtterance(session, msg.text);
    } else if (msg.type === 'barge_in') {
      sessionModule.bargeIn(session);
    } else if (msg.type === 'end') {
      await sessionModule.endSession(session, msg.reason || 'user_ended');
    }
  });
  ws.on('close', () => {
    if (session && !session.ended) {
      sessionModule.endSession(session, 'disconnect').catch(() => {});
    }
  });
});

server.listen(PORT, () => {
  console.log(`API/WS server listening on http://localhost:${PORT}`);
});
