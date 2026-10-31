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
import db from './db';
import * as events from './events';
import * as sessionModule from './session';
import {
  formatPlainTextTranscript,
  formatJsonTranscript,
  getTranscriptFilename,
} from '../src/lib/transcript';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get('/api/business', (_req, res) => {
  const b = db.prepare('SELECT * FROM businesses LIMIT 1').get();
  res.json(b);
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