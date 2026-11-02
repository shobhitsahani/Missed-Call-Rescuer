import https from 'https';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();
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
import { BUSINESS_PRESETS, DEFAULT_PRESET } from '../src/lib/presets';
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
import {
  validateStartupAuth,
  verifyAccessCode,
  signAuthToken,
  signStreamToken,
  requireAuth,
  isOpenAccess,
} from './auth';
import {
  securityHeadersMiddleware,
  createRateLimiter,
  checkRateLimit,
  isOriginAllowed,
  checkCallBudget,
} from './security';

validateStartupAuth();

const app = express();
app.set('trust proxy', 1);
app.use(securityHeadersMiddleware);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));

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

// Access code auth
app.post('/api/auth', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'global';
  const limit = checkRateLimit(`auth:${ip}`, 5, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many authentication attempts. Please wait 1 minute.' });
  }

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Access code is required.' });
  }

  if (!verifyAccessCode(code)) {
    return res.status(401).json({ error: 'Invalid access code.' });
  }

  const token = signAuthToken();
  res.json({ token, expiresIn: 43200 });
});

// Single-purpose short-lived stream token for SSE
app.get('/api/events/token', requireAuth, (_req, res) => {
  const streamToken = signStreamToken();
  res.json({ streamToken });
});

// Tokenized customer callback session metadata (public link, unguessable token)
app.get('/api/call-token/:token', (req, res) => {
  const { token } = req.params;
  if (!token) {
    return res.status(400).json({ error: 'Callback token is required.' });
  }

  // Reject guessable old IDs
  if (token.startsWith('mc_')) {
    return res.status(400).json({ error: 'Legacy or guessable IDs are not permitted. Please use a valid callback token.' });
  }

  const budget = checkCallBudget();
  if (!budget.allowed) {
    return res.status(429).json({ error: budget.reason || 'Demo is busy, try again in a minute.' });
  }

  const missed: any = db.prepare('SELECT * FROM missed_calls WHERE token = ?').get(token);
  if (!missed) {
    return res.status(404).json({ error: 'Callback session not found or link is invalid.' });
  }

  if (missed.token_expires_at) {
    const expiresAt = new Date(missed.token_expires_at).getTime();
    if (Date.now() > expiresAt) {
      return res.status(410).json({ error: 'This callback link has expired (links are valid for 30 minutes).' });
    }
  }

  if (missed.call_started_at) {
    let isReconnect = false;
    for (const s of sessionModule.getAllSessions()) {
      if (s.missedCallId === missed.id && !s.ended) {
        isReconnect = true;
        break;
      }
    }
    if (!isReconnect) {
      return res.status(409).json({ error: 'This callback link has already been used.' });
    }
  }

  const biz: any = db.prepare('SELECT name, voice FROM businesses LIMIT 1').get();
  res.json({
    valid: true,
    missedCallId: missed.id,
    token: missed.token,
    customerPhone: missed.customer_phone ? missed.customer_phone.replace(/\d(?=\d{4})/g, '*') : 'Unknown',
    businessName: biz?.name || 'Local Business',
    voice: biz?.voice || 'aai-jane',
    status: missed.status,
  });
});

app.get('/api/business', requireAuth, (_req, res) => {
  const b = db.prepare('SELECT * FROM businesses LIMIT 1').get() as any;
  if (!b) return res.status(404).json({ error: 'Business config not found' });
  res.json({
    ...b,
    services: parseServices(b.services),
    faqs: parseFaqs(b.faqs),
    timezone: b.timezone || 'Asia/Kolkata',
    voice: b.voice || 'aai-jane',
    sttProvider: sessionModule.STT_PROVIDER,
  });
});

app.get('/api/business/voices', requireAuth, (_req, res) => {
  res.json({ voices: ASSEMBLYAI_VOICES });
});

// In-memory cache for synthesized voice preview WAV audio (per voiceId)
const previewAudioCache = new Map<string, Buffer>();
const MAX_PREVIEW_CACHE = 16;

// Shared HTTP keep-alive agent dedicated exclusively to voice preview requests.
// Never shared with live call pipeline.
const previewHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
  timeout: 10000,
});

// Rate limiting: per-voice cooldown (3s) and global IP cap (20/min)
const perVoiceCooldown = new Map<string, number>(); // key: `${ip}:${voiceId}` -> timestamp
const globalIpRequests = new Map<string, number[]>(); // ip -> timestamps[]

// Fixed business greeting (9 words, 47 chars, ~1.4s audio)
const PREVIEW_TEXT = 'Thanks for calling. How can we help you today?';
const PER_VOICE_COOLDOWN_MS = 3000;
const GLOBAL_MAX_PER_MINUTE = 20;

app.post('/api/business/voice-preview', requireAuth, async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'global';
  const now = Date.now();
  const startTime = Date.now();

  const { voiceId } = req.body || {};
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Preview] Received request for voice "${voiceId}" from ${ip}`);
  }
  if (!voiceId || typeof voiceId !== 'string' || !isValidVoiceId(voiceId)) {
    return res.status(400).json({ error: 'Invalid voice ID. Please select a valid voice from the list.' });
  }

  // 1. Check in-memory audio cache first (Cache HIT costs 0 TTS credits and 0 API calls)
  const cachedWav = previewAudioCache.get(voiceId);
  if (cachedWav) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Preview] Cache HIT for voice "${voiceId}": served ${cachedWav.length} bytes in ${Date.now() - startTime}ms`);
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', cachedWav.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Audio-Cache', 'HIT');
    return res.send(cachedWav);
  }

  // 2. Rate limits for Cache MISS (synthesis generation):
  // Check per-voice cooldown (3s)
  const voiceKey = `${ip}:${voiceId}`;
  const lastVoiceTime = perVoiceCooldown.get(voiceKey) || 0;
  if (now - lastVoiceTime < PER_VOICE_COOLDOWN_MS) {
    const waitSec = Math.ceil((PER_VOICE_COOLDOWN_MS - (now - lastVoiceTime)) / 1000);
    return res.status(429).json({
      error: `Too many preview requests for this voice. Please wait ${waitSec}s.`,
    });
  }

  // Check global rate limit (20 per minute per IP)
  const ipTimestamps = (globalIpRequests.get(ip) || []).filter((t) => now - t < 60000);
  if (ipTimestamps.length >= GLOBAL_MAX_PER_MINUTE) {
    return res.status(429).json({
      error: 'Preview rate limit reached. Please wait a moment.',
    });
  }

  // Record rate limit attempts
  perVoiceCooldown.set(voiceKey, now);
  ipTimestamps.push(now);
  globalIpRequests.set(ip, ipTimestamps);

  const apiKey = process.env.ASSEMBLYAI_API_KEY || '';
  if (!apiKey) {
    return res.status(503).json({ error: 'Voice synthesis service is not configured on the server.' });
  }

  let clientAborted = false;
  let timedOut = false;
  let upstreamReq: http.ClientRequest | null = null;
  let upstreamStream: http.IncomingMessage | null = null;

  const onClientClose = () => {
    if (!res.writableEnded) {
      clientAborted = true;
      if (upstreamStream && !upstreamStream.destroyed) {
        upstreamStream.destroy();
      }
      if (upstreamReq && !upstreamReq.destroyed) {
        upstreamReq.destroy();
      }
    }
  };

  res.on('close', onClientClose);

  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    if (upstreamStream && !upstreamStream.destroyed) {
      upstreamStream.destroy();
    }
    if (upstreamReq && !upstreamReq.destroyed) {
      upstreamReq.destroy(new Error('UPSTREAM_TIMEOUT'));
    }
  }, 8000);

  try {
    const postData = JSON.stringify({
      text: PREVIEW_TEXT,
      voice_id: voiceId,
      container: 'raw',
      sample_rate: 24000,
    });

    const upstreamPromise = new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; stream: http.IncomingMessage }>((resolve, reject) => {
      const uReq = https.request(
        {
          hostname: 'tts.us.assemblyai.com',
          port: 443,
          path: '/v1/speech',
          method: 'POST',
          agent: previewHttpsAgent,
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (uRes) => {
          upstreamStream = uRes;
          resolve({ statusCode: uRes.statusCode || 500, headers: uRes.headers, stream: uRes });
        }
      );

      uReq.on('error', (err) => reject(err));

      upstreamReq = uReq;
      uReq.write(postData);
      uReq.end();
    });

    const { statusCode, stream } = await upstreamPromise;

    if (statusCode !== 200) {
      let errBody = '';
      for await (const chunk of stream) {
        errBody += chunk.toString();
      }
      console.error(`[Preview] AssemblyAI error HTTP ${statusCode}:`, errBody);
      return res.status(502).json({ error: `Voice synthesis failed (HTTP ${statusCode}).` });
    }

    const receivedChunks: Buffer[] = [];
    for await (const chunk of stream) {
      if (clientAborted || timedOut) break;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedChunks.push(buf);
    }

    if (clientAborted) {
      return;
    }

    if (timedOut) {
      if (!res.headersSent) {
        return res.status(504).json({ error: 'Voice preview synthesis timed out. Please try again.' });
      }
      return;
    }

    if (receivedChunks.length === 0) {
      if (!res.headersSent) {
        return res.status(502).json({ error: 'No audio returned from voice synthesis service.' });
      }
      return;
    }

    const pcmBuffer = Buffer.concat(receivedChunks);
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);

    if (previewAudioCache.size < MAX_PREVIEW_CACHE) {
      previewAudioCache.set(voiceId, wavBuffer);
    }

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', wavBuffer.length);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Audio-Cache', 'MISS');
      return res.send(wavBuffer);
    }
  } catch (err: any) {
    if (clientAborted) return;
    if (timedOut || err?.message === 'UPSTREAM_TIMEOUT') {
      if (!res.headersSent) {
        return res.status(504).json({ error: 'Voice preview synthesis timed out. Please try again.' });
      }
      return;
    }
    console.error('Voice preview synthesis error:', err?.message);
    if (!res.headersSent) {
      return res.status(502).json({ error: 'Voice synthesis preview failed. Please try again.' });
    }
  } finally {
    clearTimeout(timeoutTimer);
    res.off('close', onClientClose);
    if (upstreamStream && !upstreamStream.destroyed) {
      upstreamStream.destroy();
    }
    if (upstreamReq && !upstreamReq.destroyed) {
      upstreamReq.destroy();
    }
    if (process.env.NODE_ENV !== 'production') {
      const sockCount = Object.values(previewHttpsAgent.sockets).reduce((acc, arr) => acc + (arr?.length || 0), 0);
      const freeCount = Object.values(previewHttpsAgent.freeSockets).reduce((acc, arr) => acc + (arr?.length || 0), 0);
      console.log(`[Preview] Sockets: active=${sockCount}, free=${freeCount}`);
    }
  }
});

app.put('/api/business', requireAuth, (req, res) => {
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

app.get('/api/business/presets', requireAuth, (_req, res) => {
  res.json({ presets: BUSINESS_PRESETS });
});

app.post('/api/business/reset', requireAuth, (req, res) => {
  const existingBiz = db.prepare('SELECT id FROM businesses LIMIT 1').get() as any;
  const bizId = existingBiz?.id || DEFAULT_BIZ.id;

  const presetKey = req.body?.preset || req.query?.preset;
  const chosenPreset = (presetKey && BUSINESS_PRESETS[String(presetKey)]) ? BUSINESS_PRESETS[String(presetKey)] : DEFAULT_PRESET;

  db.prepare(`UPDATE businesses SET name=?, hours=?, services=?, faqs=?, tone=?, voice=?, language=?, timezone=? WHERE id=?`)
    .run(
      chosenPreset.name,
      chosenPreset.hours,
      JSON.stringify(chosenPreset.services),
      JSON.stringify(chosenPreset.faqs),
      chosenPreset.tone,
      chosenPreset.voice,
      chosenPreset.language,
      chosenPreset.timezone,
      bizId
    );

  res.json({
    ok: true,
    business: {
      ...chosenPreset,
      services: chosenPreset.services,
      faqs: chosenPreset.faqs,
    },
  });
});

app.get('/api/missed-calls', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT * FROM missed_calls ORDER BY time DESC').all();
  res.json(rows);
});

app.post('/api/missed-calls/simulate', requireAuth, (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'global';
  const limit = checkRateLimit(`sim:${ip}`, 5, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded: max 5 simulations per minute per IP.' });
  }

  const { phone, source } = req.body || {};
  const id = 'mc_' + Date.now();
  const token = crypto.randomBytes(16).toString('hex');
  const tokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const rowSource = source === 'test' ? 'test' : 'demo';

  const business: any = db.prepare('SELECT id FROM businesses LIMIT 1').get();
  const phoneNumber = phone || '+1 (555) 010-' + Math.floor(1000 + Math.random() * 9000);

  db.prepare(`
    INSERT INTO missed_calls (id, business_id, customer_phone, time, status, token, token_expires_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, business.id, phoneNumber, new Date().toISOString(), 'new', token, tokenExpiresAt, rowSource);

  const jobId = 'job_' + Date.now();
  db.prepare('INSERT INTO callback_jobs (id, missed_call_id, attempts, schedule, state) VALUES (?,?,?,?,?)')
    .run(jobId, id, 0, new Date().toISOString(), 'queued');
  db.prepare('UPDATE missed_calls SET status=? WHERE id=?').run('queued', id);

  events.broadcast('missed_call', {
    id,
    customer_phone: phoneNumber,
    token,
    source: rowSource,
  });

  res.json({
    missedCallId: id,
    jobId,
    token,
    callUrl: `/call/${token}`,
  });
});

app.post('/api/test/force-stt-disconnect', requireAuth, (req, res) => {
  const { callId, missedCallId } = req.body || {};
  let targetSession: any = null;
  if (callId) {
    targetSession = sessionModule.getSession(callId);
  } else if (missedCallId) {
    const all = sessionModule.getAllSessions();
    targetSession = all.find((s: any) => s.missedCallId === missedCallId && !s.ended && s.stt);
  } else {
    const all = sessionModule.getAllSessions();
    targetSession = all.find((s: any) => !s.ended && s.stt);
  }

  if (targetSession && targetSession.stt) {
    targetSession.stt.forceDisconnectForTesting();
    return res.json({ ok: true, message: `STT forcibly disconnected for session ${targetSession.id}` });
  }

  return res.status(404).json({ ok: false, error: 'No active session with STT found' });
});

app.get('/api/calls', requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM turns t WHERE t.call_id = c.id AND t.role = 'customer') as customer_turns_count,
      s.status as summary_status,
      s.urgency as summary_urgency,
      s.sentiment as summary_sentiment
    FROM calls c
    LEFT JOIN summaries s ON s.call_id = c.id
    ORDER BY c.start_time DESC
  `).all() as any[];

  const callsWithDetails = rows.map((r: any) => {
    const customerSpoke = (r.customer_turns_count || 0) > 0;
    const validSummary = r.summary_status === 'completed' || (!r.summary_status && r.summary_urgency && r.summary_sentiment && r.summary_status !== 'unavailable');
    const notFailedReason = !['error', 'no_answer', 'opt_out'].includes(r.end_reason);
    const is_completed = Boolean(customerSpoke && validSummary && notFailedReason);

    const { customer_turns_count, summary_status, summary_urgency, summary_sentiment, ...rest } = r;
    return {
      ...rest,
      is_completed,
      latency: r.latency_json ? JSON.parse(r.latency_json) : [],
      usage: r.usage_json ? JSON.parse(r.usage_json) : {},
    };
  });
  res.json(callsWithDetails);
});

app.get('/api/calls/:id', requireAuth, (req, res) => {
  const call = db.prepare('SELECT * FROM calls WHERE id=?').get(req.params.id);
  if (!call) return res.status(404).json({ error: 'not found' });
  const turns = db.prepare('SELECT * FROM turns WHERE call_id=? ORDER BY order_idx').all(req.params.id);
  const summary = db.prepare('SELECT * FROM summaries WHERE call_id=?').get(req.params.id);
  res.json({ call: { ...call, latency: (call as any).latency_json ? JSON.parse((call as any).latency_json) : [], usage: (call as any).usage_json ? JSON.parse((call as any).usage_json) : {} }, turns, summary });
});

app.get('/api/calls/:id/transcript', requireAuth, (req, res) => {
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

app.get('/api/summaries/:callId', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM summaries WHERE call_id=?').get(req.params.callId);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

// Admin endpoint to clean dashboard data (preserves business configuration)
app.post('/api/admin/clear-test-data', requireAuth, (req, res) => {
  const adminEnabled = process.env.ADMIN_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
  if (!adminEnabled) {
    return res.status(403).json({ error: 'Admin actions are disabled in production (ADMIN_ENABLED != true)' });
  }

  const { scope } = req.body || {};
  if (scope === 'test_only') {
    const testMissed = db.prepare('SELECT id FROM missed_calls WHERE source = ?').all('test') as { id: string }[];
    const testIds = testMissed.map((m) => m.id);
    if (testIds.length > 0) {
      const placeholders = testIds.map(() => '?').join(',');
      const calls = db.prepare(`SELECT id FROM calls WHERE missed_call_id IN (${placeholders})`).all(...testIds) as { id: string }[];
      const callIds = calls.map((c) => c.id);
      if (callIds.length > 0) {
        const callPlaceholders = callIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM summaries WHERE call_id IN (${callPlaceholders})`).run(...callIds);
        db.prepare(`DELETE FROM turns WHERE call_id IN (${callPlaceholders})`).run(...callIds);
        db.prepare(`DELETE FROM calls WHERE id IN (${callPlaceholders})`).run(...callIds);
      }
      db.prepare(`DELETE FROM callback_jobs WHERE missed_call_id IN (${placeholders})`).run(...testIds);
      db.prepare(`DELETE FROM missed_calls WHERE id IN (${placeholders})`).run(...testIds);
    }
    return res.json({ ok: true, clearedCount: testIds.length });
  }

  // Clear all call sessions, turns, summaries, callback_jobs, missed_calls — never touch businesses table
  db.prepare('DELETE FROM summaries').run();
  db.prepare('DELETE FROM turns').run();
  db.prepare('DELETE FROM calls').run();
  db.prepare('DELETE FROM callback_jobs').run();
  db.prepare('DELETE FROM missed_calls').run();
  events.broadcast('data_cleared', {});
  return res.json({ ok: true, message: 'All test and demo calls cleared. Business configuration preserved.' });
});

app.get('/api/events', requireAuth, (req, res) => {
  if (req.headers.origin && !isOriginAllowed(req.headers.origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  events.addClient(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
});

const resendTimestamps = new Map<string, number>();

app.post('/api/notify/test', requireAuth, async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'global';
  const limit = checkRateLimit(`notify_test:${ip}`, 5, 60000);
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many test notifications. Please wait 1 minute.' });
  }

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

app.post('/api/calls/:id/notify', requireAuth, async (req, res) => {
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

// Sanitized production error handler (no stack traces or secrets leaked)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const isProd = process.env.NODE_ENV === 'production';
  const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 500;
  const message = isProd ? (status === 500 ? 'Internal Server Error' : err.message) : err.message;
  res.status(status).json({
    error: message,
    ...(isProd ? {} : { stack: err.stack }),
  });
});

function getComponentsHealth() {
  const ttsKeySet = Boolean(process.env.ASSEMBLYAI_API_KEY);
  const voiceId = process.env.ASSEMBLYAI_VOICE_ID || 'aai-jane';
  const voiceValid = isValidVoiceId(voiceId);
  const sttProvider = sessionModule.STT_PROVIDER;
  const sttKeySet = sttProvider === 'assemblyai' ? ttsKeySet : true;
  const llmKeySet = Boolean(process.env.OPENAI_API_KEY);
  const llmModel = process.env.OPENAI_MODEL || 'qwen/qwen3.8-27b';
  const llmBaseUrlSet = Boolean(process.env.OPENAI_BASE_URL);

  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch {}

  const ok = dbOk && ttsKeySet && voiceValid && sttKeySet && llmKeySet;

  return {
    ok,
    components: {
      database: { status: dbOk ? 'ok' : 'error' },
      tts: {
        provider: 'assemblyai',
        apiKey: ttsKeySet ? 'configured' : 'missing',
        voiceId,
        voiceValid,
        status: ttsKeySet && voiceValid ? 'ok' : 'misconfigured',
      },
      stt: {
        provider: sttProvider,
        apiKey: sttKeySet ? 'configured' : 'missing',
        model: process.env.ASSEMBLYAI_SPEECH_MODEL || 'universal-3-6-pro',
        status: sttKeySet ? 'ok' : 'misconfigured',
      },
      llm: {
        apiKey: llmKeySet ? 'configured' : 'missing',
        model: llmModel,
        baseUrlConfigured: llmBaseUrlSet,
        status: llmKeySet ? 'ok' : 'misconfigured',
      },
    },
  };
}

function runStartupChecks() {
  const health = getComponentsHealth();
  console.log('=== Missed-Call Rescuer Configuration Check ===');
  console.log(`Database: ${health.components.database.status}`);
  console.log(`TTS: AssemblyAI [voice=${health.components.tts.voiceId}, key=${health.components.tts.apiKey}, valid=${health.components.tts.voiceValid}]`);
  console.log(`STT: ${health.components.stt.provider} [model=${health.components.stt.model}, key=${health.components.stt.apiKey}]`);
  console.log(`LLM: OpenAI/Groq [model=${health.components.llm.model}, key=${health.components.llm.apiKey}]`);
  if (!health.ok) {
    console.warn('WARNING: Component misconfiguration detected (missing API keys or invalid voice ID). Calls may fail.');
  }
  console.log('==============================================');
}

app.get('/api/health', (_req, res) => {
  const health = getComponentsHealth();
  res.json(health);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  if (req.url && req.url.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req: http.IncomingMessage) => {
  let session: any = null;
  const ip = req.headers['x-forwarded-for']
    ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
    : req.socket.remoteAddress || 'global';

  ws.on('message', async (data, isBinary) => {
    if (isBinary) {
      if (session && session.stt && !session.ended) {
        session.stt.sendAudio(data as Buffer);
        if (!session.usage.sttSeconds) session.usage.sttSeconds = 0;
        session.usage.sttSeconds += (data as Buffer).length / 32000;
      }
      return;
    }
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (msg.type === 'join') {
      const joinLimit = checkRateLimit(`wsjoin:${ip}`, 10, 60000);
      if (!joinLimit.allowed) {
        ws.send(JSON.stringify({ type: 'error', message: 'Too many call join requests. Please wait a moment.' }));
        ws.close();
        return;
      }

      try {
        session = await sessionModule.startSession(ws, msg.token || msg.missedCallId);
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
  runStartupChecks();
});
