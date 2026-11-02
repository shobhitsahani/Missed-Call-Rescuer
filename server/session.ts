import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import db from './db';
import * as llm from './llm';
import * as events from './events';
import { TtsClient } from './tts';
import { SttClient } from './stt';
import { notifyCallSummary } from './notify';
import { isValidVoiceId } from '../src/lib/voices';
import { checkCallBudget, MAX_CALL_SECONDS } from './security';
import { PhoneStatus, isPhoneRefusal, extractPhoneFromUtterance, maskPhone } from './phone';

export interface SessionTurn {
  role: string;
  text: string;
  interrupted: boolean;
}

export interface SessionUsage {
  ttsChars: number;
  sttSeconds: number;
  llmTokens: number;
}

export interface LatencyMetricItem {
  totalMs: number;
  llmFirstTokenMs: number | null;
  ttsFirstAudioMs: number | null;
  turnDetectionMs?: number | null;
}

export type SessionLatency = number | LatencyMetricItem;

export interface SessionBusiness {
  id: string;
  name: string;
  hours: string;
  services: string;
  faqs: string;
  tone: string;
  voice: string;
  language?: string;
  timezone: string;
  owner_email?: string;
  [key: string]: unknown;
}

export interface Session {
  id: string;
  ws: WebSocket | null;
  business: SessionBusiness;
  missedCallId: string | null;
  customerPhone: string;
  phoneStatus: PhoneStatus;
  verifiedCallerPhone: string | null;
  collectedPhone: string | null;
  pendingPhoneDigits: string | null;
  lastPhonePromptTurn: number;
  state: string;
  turns: SessionTurn[];
  turnOrder: number;
  generating: boolean;
  cancelGeneration: boolean;
  abortController: AbortController | null;
  ended: boolean;
  startedAt: number;
  latencies: SessionLatency[];
  usage: SessionUsage;
  silenceTimer: NodeJS.Timeout | null;
  maxTimer: NodeJS.Timeout | null;
  tts: TtsClient;
  stt: SttClient | null;
  keepAliveTimer: NodeJS.Timeout | null;
  ttsFailed: boolean;
  currentAgentText: string;
  agentSpeakingStartTime: number;
  sttProvider: string;
  notificationDispatched?: boolean;
  disconnectTimer?: NodeJS.Timeout | null;
  finalizing?: boolean;
  pendingEndReason?: string;
  terminationTimer?: NodeJS.Timeout | null;
  fallbackTerminationTimer?: NodeJS.Timeout | null;
  playbackCompleted?: boolean;
  finalAudioSent?: boolean;
}

export const sessions = new Map<string, Session>();

export const STT_PROVIDER = process.env.STT_PROVIDER || 'assemblyai';

const OPT_OUT_PHRASES = ['stop calling', 'do not call', "don't call", 'remove me', 'opt out', 'opt-out', 'no more calls', 'leave me alone'];
const WRONG_NUMBER = ['wrong number', 'not the right person', 'you have the wrong'];

function getBusinessRow() {
  return db.prepare('SELECT * FROM businesses LIMIT 1').get() as Record<string, unknown> | undefined;
}

function rowToBiz(r?: Record<string, unknown>): SessionBusiness {
  if (!r) {
    return {
      id: 'default',
      name: 'Business',
      hours: '',
      services: '',
      faqs: '',
      tone: 'friendly, professional, concise',
      voice: 'aai-jane',
      timezone: 'UTC',
    };
  }
  return {
    id: String(r.id || 'default'),
    name: String(r.name || 'Business'),
    hours: String(r.hours || ''),
    services: String(r.services || ''),
    faqs: String(r.faqs || ''),
    tone: String(r.tone || 'friendly, professional, concise'),
    voice: String(r.voice || 'aai-jane'),
    language: r.language ? String(r.language) : undefined,
    timezone: String(r.timezone || 'UTC'),
    owner_email: r.owner_email ? String(r.owner_email) : undefined,
  };
}

function detectOptOut(text: string) {
  const t = (text || '').toLowerCase();
  return OPT_OUT_PHRASES.some(p => t.includes(p));
}
function detectWrongNumber(text: string) {
  const t = (text || '').toLowerCase();
  return WRONG_NUMBER.some(p => t.includes(p));
}

export function isClosingSignoff(text: string): boolean {
  const clean = (text || '').trim();
  // Any sentence with a trailing question mark is an ongoing inquiry, not a sign-off
  if (/[?]\s*$/.test(clean)) return false;

  const lower = clean.toLowerCase();

  // Direct standalone sign-offs
  if (/^(?:goodbye|bye|bye\s+now|bye-bye|take\s+care|have\s+a\s+(?:great|good|wonderful|nice)\s+(?:day|rest\s+of\s+your\s+day|afternoon|evening|weekend))[.!]?$/i.test(lower)) {
    return true;
  }

  // Compound sign-off statements (must not end in a question and must conclude with closing sentiment)
  const hasClosingPhrase = /(?:thank\s+you\s+for\s+calling|thanks\s+for\s+calling|have\s+a\s+(?:great|good|wonderful|nice)\s+(?:day|rest\s+of\s+your\s+day|afternoon|evening|weekend)|goodbye|bye|take\s+care|we'?ll\s+be\s+in\s+touch|talk\s+to\s+you\s+soon)/i.test(lower);
  const hasSignoffEnding = /(?:goodbye|bye|take\s+care|have\s+a\s+(?:great|good|wonderful|nice)\s+(?:day|rest\s+of\s+your\s+day|afternoon|evening|weekend)|in\s+touch)[.!]?$/i.test(lower);

  return hasClosingPhrase && hasSignoffEnding;
}

export function isCustomerWrapUp(text: string): boolean {
  const lower = (text || '').trim().toLowerCase();
  return /(?:that'?s\s+(?:all|everything)|thank\s+you|thanks|no,?\s+that'?s\s+it|no\s+more|you\s+too|all\s+good|all\s+set|bye|goodbye|have\s+a\s+(?:good|great)\s+day)/i.test(lower);
}

export function isFinalClosingTurn(agentText: string, customerText: string, hasExplicitSignal = false): boolean {
  const cleanAgent = (agentText || '').trim();
  // Never terminate if the agent asked a question
  if (/[?]\s*$/.test(cleanAgent)) return false;

  // 1. Explicit internal signal from LLM ([CALL_COMPLETE])
  if (hasExplicitSignal) return true;

  // 2. Structured conversation closing:
  // If agent delivered a conclusive sign-off AND either customer signaled wrap-up or agent gave complete parting statement
  if (isClosingSignoff(cleanAgent)) {
    if (isCustomerWrapUp(customerText) || /thank\s+you\s+for\s+calling/i.test(cleanAgent) || /^(?:goodbye|bye|take\s+care)/i.test(cleanAgent)) {
      return true;
    }
  }

  return false;
}

function sanitizeErrorMsg(msg?: string): string {
  if (!msg) return 'Unknown error';
  return msg
    .replace(/wss?:\/\/[^\s]+/g, '[server]')
    .replace(/(?:key=|token=)[^\s&]+/gi, '[redacted]')
    .slice(0, 200);
}

function withStageTimeout<T>(promise: Promise<T>, timeoutMs: number, stageName: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${stageName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function similar(a: string, b: string) {
  const na = a.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const nb = b.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (!na || !nb) return false;
  if (nb.includes(na) || na.includes(nb)) return true;
  const wa = new Set(na.split(/\s+/));
  const wb = new Set(nb.split(/\s+/));
  let overlap = 0;
  for (const w of wa) if (wb.has(w)) overlap++;
  const ratio = overlap / Math.max(wa.size, wb.size, 1);
  return ratio > 0.6;
}

const FIRST_CHUNK_MIN_WORDS = parseInt(process.env.FIRST_CHUNK_MIN_WORDS || '6', 10);

function extractNextChunk(buf: string, isFirst: boolean): { chunk: string; remaining: string } | null {
  if (isFirst) {
    // 1. Look for comma or clause boundary or sentence end: , ; : — -- . ! ?
    const puncMatch = buf.match(/^([\s\S]*?([,;:!?]|—|--))(\s+|$)/);
    // 2. Look for at least FIRST_CHUNK_MIN_WORDS words followed by whitespace
    const wordsRegex = new RegExp(`^(\\s*(?:\\S+\\s+){${Math.max(1, FIRST_CHUNK_MIN_WORDS - 1)}}\\S+)\\s+`);
    const wordsMatch = buf.match(wordsRegex);

    if (puncMatch && wordsMatch) {
      if (puncMatch[1].length <= wordsMatch[1].length) {
        return {
          chunk: puncMatch[1].trim(),
          remaining: buf.slice(puncMatch[0].length),
        };
      } else {
        return {
          chunk: wordsMatch[1].trim(),
          remaining: buf.slice(wordsMatch[0].length),
        };
      }
    } else if (puncMatch) {
      return {
        chunk: puncMatch[1].trim(),
        remaining: buf.slice(puncMatch[0].length),
      };
    } else if (wordsMatch) {
      return {
        chunk: wordsMatch[1].trim(),
        remaining: buf.slice(wordsMatch[0].length),
      };
    }
    return null;
  } else {
    // Standard sentence boundary: sentence ending in . ! ? followed by whitespace or end
    const sentenceMatch = buf.match(/^([\s\S]*?[.!?]+)(\s+|$)/);
    if (sentenceMatch) {
      return {
        chunk: sentenceMatch[1].trim(),
        remaining: buf.slice(sentenceMatch[0].length),
      };
    }
    return null;
  }
}

function send(session: Session, msg: Record<string, unknown>) {
  if (session.ws && session.ws.readyState === 1) {
    try { session.ws.send(JSON.stringify(msg)); } catch {}
  }
}

function sendBinary(session: Session, data: Uint8Array) {
  if (session.ws && session.ws.readyState === 1) {
    try { session.ws.send(data, { binary: true }); } catch {}
  }
}

function setState(session: Session, state: string) {
  session.state = state;
  send(session, { type: 'state', state });
}

function addTurn(session: Session, role: string, text: string, interrupted = false, deferDb = false) {
  session.turnOrder += 1;
  const orderIdx = session.turnOrder;
  const turnId = uuidv4();
  const ts = new Date().toISOString();
  session.turns.push({ role, text, interrupted });

  const persist = () => {
    try {
      db.prepare('INSERT INTO turns (id, call_id, order_idx, role, text, interrupted, ts) VALUES (?,?,?,?,?,?,?)')
        .run(turnId, session.id, orderIdx, role, text, interrupted ? 1 : 0, ts);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('Failed to insert turn:', errMsg);
    }
  };

  if (deferDb) {
    setImmediate(persist);
  } else {
    persist();
  }
}

async function speakSentence(
  session: Session,
  sentence: string,
  onFirstAudio?: () => void,
  onGenerateSent?: () => void
): Promise<{ ok: boolean; pcmBytes: number }> {
  if (session.ended || session.cancelGeneration) return { ok: false, pcmBytes: 0 };
  session.currentAgentText = sentence;
  session.agentSpeakingStartTime = Date.now();
  send(session, { type: 'agent_text', text: sentence });
  session.usage.ttsChars += sentence.length;

  let totalBytes = 0;
  const trySpeak = async (): Promise<boolean> => {
    let firstChunk = true;
    for await (const chunk of session.tts.speak(sentence, onGenerateSent)) {
      if (session.cancelGeneration || session.ended) {
        try { session.tts.cancel(); } catch {}
        return true; // cancelled, not a failure
      }
      if (firstChunk) {
        firstChunk = false;
        if (onFirstAudio) onFirstAudio();
      }
      totalBytes += chunk.byteLength || chunk.length || 0;
      sendBinary(session, chunk);
    }
    return true;
  };

  try {
    const ok = await trySpeak();
    return { ok, pcmBytes: totalBytes };
  } catch (err: unknown) {
    if (session.cancelGeneration || session.ended) return { ok: true, pcmBytes: totalBytes };
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('TTS error:', errMsg);
    // retry once
    try {
      await session.tts.connectWithRetry();
      const ok = await trySpeak();
      return { ok, pcmBytes: totalBytes };
    } catch (err2: unknown) {
      const err2Msg = err2 instanceof Error ? err2.message : String(err2);
      console.error('TTS retry failed:', err2Msg);
      send(session, { type: 'error', message: 'Voice synthesis failed. Ending call.' });
      await endSession(session, 'error');
      return { ok: false, pcmBytes: totalBytes };
    }
  }
}

export async function startSession(ws: WebSocket, missedCallTokenOrId?: string) {
  const budget = checkCallBudget();
  if (!budget.allowed) {
    throw new Error(budget.reason || 'Demo is busy, try again in a minute');
  }

  interface MissedRow {
    id: string;
    business_id: string;
    customer_phone: string;
    token_expires_at?: string;
    call_started_at?: string;
    phone_verified?: number;
    source?: string;
  }

  let missed: MissedRow | undefined = undefined;
  if (missedCallTokenOrId) {
    // Only opaque callback tokens are accepted. Guessable database IDs
    // (mc_<timestamp>) must never be usable to join someone else's call.
    if (missedCallTokenOrId.startsWith('mc_') || !/^[a-f0-9]{32}$/i.test(missedCallTokenOrId)) {
      throw new Error('Invalid callback token');
    }
    missed = db.prepare('SELECT * FROM missed_calls WHERE token = ?').get(missedCallTokenOrId) as MissedRow | undefined;
  }
  if (!missed) {
    throw new Error('Callback session not found');
  }

  // Token expiration check (30 minutes)
  if (missed.token_expires_at) {
    const expiresAt = new Date(missed.token_expires_at).getTime();
    if (Date.now() > expiresAt) {
      throw new Error('Callback link has expired (valid for 30 minutes)');
    }
  }

  // Single-use check: atomically claim the link. If another socket already
  // started it, only an active reconnect for the same missed call is allowed.
  if (missed.call_started_at) {
    const existingSession = Array.from(sessions.values()).find(
      (s) => s.missedCallId === missed?.id && !s.ended
    );
    if (existingSession) {
      if (existingSession.finalizing || existingSession.state === 'FINALIZING' || existingSession.state === 'ENDING' || existingSession.state === 'DONE') {
        throw new Error('This callback link has already been used');
      }
      if (existingSession.disconnectTimer) {
        clearTimeout(existingSession.disconnectTimer);
        existingSession.disconnectTimer = null;
      }
      existingSession.ws = ws;
      console.log(`[session ${existingSession.id}] Client reconnected WebSocket to active session`);
      send(existingSession, { type: 'config', sttProvider: STT_PROVIDER });
      send(existingSession, { type: 'state', state: existingSession.state });
      for (const turn of existingSession.turns) {
        if (turn.role === 'agent') {
          send(existingSession, { type: 'agent_text', text: turn.text });
        } else {
          send(existingSession, { type: 'customer_transcript', text: turn.text });
        }
      }
      return existingSession;
    }
    throw new Error('This callback link has already been used');
  } else {
    const claim = db.prepare('UPDATE missed_calls SET call_started_at = ? WHERE id = ? AND call_started_at IS NULL')
      .run(new Date().toISOString(), missed.id);
    if (claim.changes === 0) {
      throw new Error('This callback link has already been used');
    }
  }

  const business = rowToBiz(getBusinessRow());
  const callId = uuidv4();
  const isCallerVerified = Boolean(
    missed &&
    missed.phone_verified === 1 &&
    missed.customer_phone &&
    missed.customer_phone !== 'unknown'
  );

  const initialPhoneStatus: PhoneStatus = isCallerVerified ? 'verified' : 'unknown';
  const verifiedCallerPhone = isCallerVerified ? missed!.customer_phone : null;
  const customerPhone = missed ? missed.customer_phone : 'unknown';
  const businessId = missed ? missed.business_id : business.id;
  db.prepare('INSERT INTO calls (id, missed_call_id, business_id, customer_phone, start_time, phone_verified) VALUES (?,?,?,?,?,?)')
    .run(callId, missed ? missed.id : null, businessId, customerPhone, new Date().toISOString(), isCallerVerified ? 1 : 0);
  if (missed) {
    db.prepare('UPDATE missed_calls SET status=? WHERE id=?').run('calling', missed.id);
  }

  const voiceId = (business?.voice && isValidVoiceId(business.voice))
    ? business.voice
    : (process.env.ASSEMBLYAI_VOICE_ID && isValidVoiceId(process.env.ASSEMBLYAI_VOICE_ID))
      ? process.env.ASSEMBLYAI_VOICE_ID
      : 'aai-jane';
  const apiKey = process.env.ASSEMBLYAI_API_KEY || '';
  const tts = new TtsClient({ apiKey, voiceId, sampleRate: 24000, encoding: 'pcm_s16le', language: 'english' });

  const session: Session = {
    id: callId,
    ws,
    business,
    missedCallId: missed ? missed.id : null,
    customerPhone,
    phoneStatus: initialPhoneStatus,
    verifiedCallerPhone,
    collectedPhone: null,
    pendingPhoneDigits: null,
    lastPhonePromptTurn: 0,
    state: 'GREETING',
    turns: [],
    turnOrder: 0,
    generating: false,
    cancelGeneration: false,
    abortController: null,
    ended: false,
    startedAt: Date.now(),
    latencies: [],
    usage: { ttsChars: 0, sttSeconds: 0, llmTokens: 0 },
    silenceTimer: null,
    maxTimer: null,
    tts,
    stt: null,
    keepAliveTimer: null,
    ttsFailed: false,
    currentAgentText: '',
    agentSpeakingStartTime: 0,
    sttProvider: STT_PROVIDER,
  };
  sessions.set(callId, session);

  // Inform client of session config and STT provider
  send(session, { type: 'config', sttProvider: STT_PROVIDER });

  // connect TTS
  send(session, { type: 'progress', stage: 'tts_connect', message: 'Connecting audio...' });
  try {
    await withStageTimeout(tts.connectWithRetry(), 10000, 'TTS connect');
  } catch (err: unknown) {
    const errorMsg = sanitizeErrorMsg(err instanceof Error ? err.message : String(err));
    console.error(`[session ${session.id}] stage=tts_connect error=${errorMsg}`);
    send(session, {
      type: 'error',
      code: 'tts_connect',
      message: `Could not connect voice assistant audio: ${errorMsg}`,
    });
    await endSession(session, 'error');
    return session;
  }

  // connect AssemblyAI STT if enabled
  if (STT_PROVIDER === 'assemblyai') {
    send(session, { type: 'progress', stage: 'stt_connect', message: 'Connecting speech recognition...' });
    const stt = new SttClient({
      apiKey,
      speechModel: process.env.ASSEMBLYAI_SPEECH_MODEL || undefined,
    });
    session.stt = stt;

    stt.onSpeechStart(() => {
      // Speech started signal available if needed
    });

    stt.onPartial((text) => {
      if (session.ended || session.finalizing) return;
      send(session, { type: 'partial', text });

      // Server-side barge-in decision
      if (session.state === 'SPEAKING' || session.state === 'THINKING') {
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        const speakingFor = Date.now() - (session.agentSpeakingStartTime || 0);
        if (words >= 2 && speakingFor >= 400 && !similar(text, session.currentAgentText || '')) {
          bargeIn(session);
        }
      }
    });

    stt.onFinalTurn((text, _words, _turnOrder, _confidence, turnDetectionMs) => {
      if (session.ended || session.finalizing) return;
      session.stt?.clearRecentAudio();
      const cleaned = (text || '').trim();
      if (!cleaned) return;
      send(session, { type: 'partial', text: '' });
      send(session, { type: 'customer_transcript', text: cleaned });
      if (session.generating) {
        // Customer spoke over the agent: cancel the current reply, then
        // process this final utterance instead of silently dropping it.
        bargeIn(session);
      }
      void handleCustomerUtterance(session, cleaned, turnDetectionMs).catch((err: unknown) => {
        console.error(`[session ${session.id}] handleCustomerUtterance error:`, err instanceof Error ? err.message : String(err));
      });
    });

    stt.onReconnecting((attempt) => {
      if (session.ended) return;
      console.log(`[session ${session.id}] STT reconnecting (attempt ${attempt})...`);
      send(session, { type: 'state', state: 'RECONNECTING' });
    });

    stt.onReconnected(() => {
      if (session.ended) return;
      console.log(`[session ${session.id}] STT reconnected`);
      send(session, { type: 'state', state: session.state });
    });

    stt.onError(async (err) => {
      if (session.ended) return;
      const errorMsg = sanitizeErrorMsg(err?.message);
      console.error(`[session ${session.id}] stage=stt_runtime error=${errorMsg}`);
      send(session, {
        type: 'error',
        code: 'stt_runtime',
        message: 'Speech recognition service error. Ending call.',
      });
      await endSession(session, 'error');
    });

    try {
      await withStageTimeout(stt.connectWithRetry(), 10000, 'STT connect');
    } catch (err: unknown) {
      const errorMsg = sanitizeErrorMsg(err instanceof Error ? err.message : String(err));
      console.error(`[session ${session.id}] stage=stt_connect error=${errorMsg}`);
      send(session, {
        type: 'error',
        code: 'stt_connect',
        message: `Could not connect speech recognition: ${errorMsg}`,
      });
      await endSession(session, 'error');
      return session;
    }
  }

  session.maxTimer = setTimeout(() => endSession(session, 'timeout'), MAX_CALL_SECONDS * 1000);
  session.keepAliveTimer = setInterval(() => {
    if (!session.ended) {
      try { session.tts.keepAlive(); } catch {}
    }
  }, 30000);

  send(session, { type: 'progress', stage: 'greeting', message: 'Starting assistant...' });
  setState(session, 'GREETING');
  const greeting = `Hi, this is an automated assistant calling on behalf of ${business.name}. We noticed we missed your call earlier. Is now a good time to chat?`;
  session.state = 'SPEAKING';
  session.currentAgentText = greeting;
  session.agentSpeakingStartTime = Date.now();
  send(session, { type: 'state', state: 'SPEAKING' });
  try {
    const speakRes = await withStageTimeout(speakSentence(session, greeting, () => {}), 10000, 'Greeting audio playback');
    if (!speakRes.ok || session.ended) return session;
  } catch (err: unknown) {
    const errorMsg = sanitizeErrorMsg(err instanceof Error ? err.message : String(err));
    console.error(`[session ${session.id}] stage=greeting error=${errorMsg}`);
    send(session, {
      type: 'error',
      code: 'greeting',
      message: `Could not start assistant greeting: ${errorMsg}`,
    });
    await endSession(session, 'error');
    return session;
  }

  addTurn(session, 'agent', greeting, false);
  if (!session.ended) {
    setState(session, 'LISTENING');
  }
  return session;
}

export async function handleCustomerUtterance(session: Session, text: string, turnDetectionMs?: number | null) {
  if (session.ended || session.finalizing) return;
  text = (text || '').trim();
  if (!text) return;
  if (session.generating) {
    // drop overlapping utterances to avoid garbled turns
    return;
  }

  const t_turn_end = Date.now();

  if (detectOptOut(text)) {
    session.finalizing = true;
    session.pendingEndReason = 'opted_out';
    addTurn(session, 'customer', text, false);
    const reply = "I understand. I'll make sure we stop calling. Sorry for the inconvenience. Goodbye.";
    session.state = 'SPEAKING';
    session.currentAgentText = reply;
    session.agentSpeakingStartTime = Date.now();
    send(session, { type: 'state', state: 'SPEAKING' });
    const speakRes = await speakSentence(session, reply, () => {});
    addTurn(session, 'agent', reply, false);
    const durationMs = Math.round((speakRes.pcmBytes || 0) / 48);
    scheduleFinalization(session, 'opted_out', durationMs);
    return;
  }
  if (detectWrongNumber(text)) {
    session.finalizing = true;
    session.pendingEndReason = 'wrong_number';
    addTurn(session, 'customer', text, false);
    const reply = "I'm sorry about that. I'll update our records. Have a good day. Goodbye.";
    session.state = 'SPEAKING';
    session.currentAgentText = reply;
    session.agentSpeakingStartTime = Date.now();
    send(session, { type: 'state', state: 'SPEAKING' });
    const speakRes = await speakSentence(session, reply, () => {});
    addTurn(session, 'agent', reply, false);
    const durationMs = Math.round((speakRes.pcmBytes || 0) / 48);
    scheduleFinalization(session, 'wrong_number', durationMs);
    return;
  }

  // 1. Phone refusal check
  if (session.phoneStatus !== 'verified' && session.phoneStatus !== 'validated' && session.phoneStatus !== 'confirmed') {
    if (isPhoneRefusal(text)) {
      session.phoneStatus = 'declined';
      session.pendingPhoneDigits = null;
      console.log(`[session ${session.id}] Contact status -> declined`);
    }
  }

  // 2. Phone extraction & validation check
  // Ambiguous 10-digit numbers follow the business locale: Indian businesses
  // treat 6-9 prefixes as +91, everyone else as NANP +1.
  const phoneCountry: 'US' | 'IN' = /india|kolkata|calcutta/i.test(session.business.timezone || '') ? 'IN' : 'US';
  const extracted = extractPhoneFromUtterance(text, phoneCountry, session.pendingPhoneDigits);
  if (extracted) {
    if (extracted.isValid && extracted.normalized) {
      const sameAsVerified = session.phoneStatus === 'verified'
        && session.verifiedCallerPhone === extracted.normalized;
      if (!sameAsVerified) {
        session.phoneStatus = session.phoneStatus === 'verified' ? 'confirmed' : 'validated';
        session.collectedPhone = extracted.normalized;
        session.customerPhone = extracted.normalized;
        session.pendingPhoneDigits = null;
        console.log(`[session ${session.id}] Contact status -> ${session.phoneStatus} (${maskPhone(extracted.normalized)})`);
        try {
          // Spoken numbers are not carrier caller-ID, so they are stored as
          // collected/confirmed rather than verified.
          db.prepare('UPDATE calls SET customer_phone = ?, phone_verified = 0 WHERE id = ?').run(extracted.normalized, session.id);
          if (session.missedCallId) {
            db.prepare('UPDATE missed_calls SET customer_phone = ?, phone_verified = 0 WHERE id = ?').run(extracted.normalized, session.missedCallId);
          }
        } catch (dbErr) {
          console.error('Failed to update call customer_phone:', dbErr);
        }
      }
    } else if (
      extracted.reason === 'incomplete'
      && session.phoneStatus !== 'declined'
      && session.phoneStatus !== 'verified'
      && session.phoneStatus !== 'validated'
      && session.phoneStatus !== 'confirmed'
    ) {
      session.phoneStatus = 'collected'; // incomplete digits
      session.pendingPhoneDigits = extracted.digits;
      console.log(`[session ${session.id}] Contact status -> collected (incomplete: ${extracted.digits.length} digits, pending: ${extracted.digits})`);
    }
  } else if (session.pendingPhoneDigits) {
    // If utterance contains substantive non-phone speech, clear stale pending digits
    // so unrelated future remarks cannot be mistakenly stitched.
    const words = text.trim().split(/\s+/).length;
    if (words >= 2) {
      session.pendingPhoneDigits = null;
    }
  }

  // Add turn in memory immediately, defer SQLite DB write off critical path
  addTurn(session, 'customer', text, false, true);

  const customerTurnCount = session.turns.filter((t: SessionTurn) => t.role === 'customer').length;
  const callContext: llm.CallContext = {
    phoneStatus: session.phoneStatus,
    verifiedCallerPhone: session.verifiedCallerPhone,
    collectedPhone: session.collectedPhone,
    turnCount: customerTurnCount,
  };

  setState(session, 'THINKING');
  session.generating = true;
  session.cancelGeneration = false;
  const controller = new AbortController();
  session.abortController = controller;

  let firstAudioSent = false;
  let t_llm_first_token: number | null = null;
  let t_tts_generate_sent: number | null = null;
  let t_tts_first_audio: number | null = null;

  const markFirstAudio = () => {
    if (firstAudioSent || session.cancelGeneration) return;
    firstAudioSent = true;
    t_tts_first_audio = Date.now();
    const llmFirstTokenMs = (t_llm_first_token !== null && t_llm_first_token >= t_turn_end)
      ? t_llm_first_token - t_turn_end
      : null;
    const ttsFirstAudioMs = (t_tts_generate_sent !== null && t_tts_first_audio !== null && t_tts_first_audio >= t_tts_generate_sent)
      ? t_tts_first_audio - t_tts_generate_sent
      : null;
    const totalMs = t_tts_first_audio - t_turn_end;

    // Validate that totalMs is a positive finite number representing elapsed ms
    if (typeof totalMs !== 'number' || !Number.isFinite(totalMs) || totalMs <= 0) {
      console.warn(`[turn] Rejected invalid latency measurement: totalMs=${totalMs}`);
      return;
    }

    const metricItem: LatencyMetricItem = {
      totalMs,
      llmFirstTokenMs: (llmFirstTokenMs !== null && Number.isFinite(llmFirstTokenMs) && llmFirstTokenMs >= 0) ? llmFirstTokenMs : null,
      ttsFirstAudioMs: (ttsFirstAudioMs !== null && Number.isFinite(ttsFirstAudioMs) && ttsFirstAudioMs >= 0) ? ttsFirstAudioMs : null,
      turnDetectionMs: (typeof turnDetectionMs === 'number' && Number.isFinite(turnDetectionMs) && turnDetectionMs >= 0) ? turnDetectionMs : null,
    };

    session.latencies.push(metricItem);

    // Persist immediately to SQLite so live dashboard reads updated latency even mid-call
    try {
      db.prepare('UPDATE calls SET latency_json=? WHERE id=?')
        .run(JSON.stringify(session.latencies), session.id);
      events.broadcast('call_updated', { callId: session.id });
    } catch (err) {
      console.error(`[session ${session.id}] Error saving turn latency:`, err);
    }

    send(session, {
      type: 'metrics',
      totalMs,
      llmFirstTokenMs: metricItem.llmFirstTokenMs,
      ttsFirstAudioMs: metricItem.ttsFirstAudioMs,
      turnDetectionMs: metricItem.turnDetectionMs,
      timeToFirstAudio: totalMs,
    });
    console.log(`[turn] turn_detection=${turnDetectionMs ?? '-'}ms llm_first_token=${metricItem.llmFirstTokenMs ?? '-'}ms tts_first_audio=${metricItem.ttsFirstAudioMs ?? '-'}ms total=${totalMs}ms`);
  };

  const messages: llm.ChatMessage[] = session.turns
    .filter((t: SessionTurn) => t.role === 'customer' || t.role === 'agent')
    .map((t: SessionTurn) => ({ role: (t.role === 'agent' ? 'assistant' : 'user') as 'assistant' | 'user', content: t.text }));

  // chunk queue consumer
  const chunkQueue: string[] = [];
  let llmDone = false;
  let buffer = '';
  let fullReply = '';

  const llmPromise = (async () => {
    let isFirstChunk = true;
    try {
      await llm.streamChat(messages, session.business, (delta: string) => {
        if (session.cancelGeneration) return;
        if (t_llm_first_token === null) t_llm_first_token = Date.now();
        buffer += delta;
        fullReply += delta;

        let res;
        while ((res = extractNextChunk(buffer, isFirstChunk))) {
          buffer = res.remaining;
          if (res.chunk) {
            chunkQueue.push(res.chunk);
            isFirstChunk = false;
          }
        }
      }, controller.signal, callContext);
    } catch (e: unknown) {
      if (!session.cancelGeneration) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[session ${session.id}] stage=llm error=${sanitizeErrorMsg(errMsg)}`);
      }
    } finally {
      const rest = buffer.trim();
      if (rest && !session.cancelGeneration) {
        chunkQueue.push(rest);
      }

      // Deterministic Contact Policy Guard
      if (!session.cancelGeneration && !session.ended) {
        const askedForPhone = /phone\s*(number)?|callback\s*number|reach\s*you|best\s*number/i.test(fullReply);
        if (askedForPhone) {
          session.lastPhonePromptTurn = customerTurnCount;
        }

        const isWrappingUp = /goodbye|bye|have a (great|good) (day|rest)|we'?ll (be in touch|follow up|reach out)|take care|thank you for calling/i.test(fullReply) ||
                             /that'?s (all|everything)|thank you|thanks|no that'?s it|bye/i.test(text);

        // Never prompt if phone is already secured or declined
        if (
          session.phoneStatus === 'validated' ||
          session.phoneStatus === 'confirmed' ||
          session.phoneStatus === 'verified' ||
          session.phoneStatus === 'declined'
        ) {
          // Phone requirement already satisfied or declined. Do not inject any phone prompts.
        } else if (session.phoneStatus === 'unknown' && !askedForPhone && (isWrappingUp || customerTurnCount >= 2)) {
          const promptSentence = "Before we wrap up, what is the best phone number for our team to call you back?";
          chunkQueue.push(promptSentence);
          fullReply += (fullReply ? ' ' : '') + promptSentence;
          session.lastPhonePromptTurn = customerTurnCount;
          console.log(`[session ${session.id}] Guard enforced callback phone prompt (turn=${customerTurnCount})`);
        } else if (session.phoneStatus === 'collected' && !askedForPhone) {
          const repeatSentence = "Could you please repeat your full 10-digit phone number?";
          // Eliminate duplicate/conflicting questions in a single turn:
          // If the reply already ended with a question (e.g. "What was your call about?"), replace it
          if (/[?]\s*$/.test(fullReply.trim())) {
            const withoutTrailingQ = fullReply.trim().replace(/[A-Z][^?]*\?\s*$/i, '').trim();
            fullReply = (withoutTrailingQ ? withoutTrailingQ + ' ' : '') + repeatSentence;
            chunkQueue.length = 0;
            chunkQueue.push(repeatSentence);
          } else {
            // Strip any trailing incomplete clause without end punctuation to avoid run-on sentences
            const completeSentences = fullReply.match(/^[\s\S]*[.!](\s+|$)/);
            const prefix = completeSentences ? completeSentences[0].trim() : '';
            fullReply = (prefix ? prefix + ' ' : '') + repeatSentence;
            chunkQueue.length = 0;
            chunkQueue.push(repeatSentence);
          }
          session.lastPhonePromptTurn = customerTurnCount;
          console.log(`[session ${session.id}] Guard enforced repeat phone prompt for incomplete digits`);
        }
      }

      llmDone = true;
    }
  })();

  // consumer
  let isFirstConsumerChunk = true;
  let totalAudioPcmBytes = 0;
  while (!session.ended && !session.cancelGeneration) {
    if (chunkQueue.length === 0) {
      if (llmDone) break;
      await new Promise((r) => setTimeout(r, 15));
      continue;
    }
    let chunk = chunkQueue.shift()!;
    // Strip [CALL_COMPLETE] token from chunks so TTS never synthesizes it
    chunk = chunk.replace(/\[CALL_COMPLETE\]/gi, '').trim();
    if (!chunk) continue;

    // Guard against redundant phone requests if phone is already verified or collected
    if (session.phoneStatus === 'verified' || session.phoneStatus === 'validated' || session.phoneStatus === 'confirmed') {
      const phonePromptPattern = /(what(?:'s|\s+is)\s+(?:the\s+best|your)\s+phone\s+number|can\s+I\s+get\s+your\s+phone\s+number|could\s+you\s+(?:provide|give\s+me|repeat)\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number|please\s+repeat\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number)/i;
      if (phonePromptPattern.test(chunk)) {
        chunk = chunk.replace(/(what(?:'s|\s+is)\s+(?:the\s+best|your)\s+phone\s+number|can\s+I\s+get\s+your\s+phone\s+number|could\s+you\s+(?:provide|give\s+me|repeat)\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number|please\s+repeat\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number)[^.!?]*[.!?]?/gi, 'We have your phone number on file.');
      }
    } else if (session.phoneStatus === 'declined') {
      const phonePromptPattern = /(what(?:'s|\s+is)\s+(?:the\s+best|your)\s+phone\s+number|can\s+I\s+get\s+your\s+phone\s+number|could\s+you\s+(?:provide|give\s+me|repeat)\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number|please\s+repeat\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number)/i;
      if (phonePromptPattern.test(chunk)) {
        chunk = chunk.replace(/(what(?:'s|\s+is)\s+(?:the\s+best|your)\s+phone\s+number|can\s+I\s+get\s+your\s+phone\s+number|could\s+you\s+(?:provide|give\s+me|repeat)\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number|please\s+repeat\s+(?:your\s+)?(?:full\s+)?(?:10-digit\s+)?phone\s+number)[^.!?]*[.!?]?/gi, 'Understood, no problem.');
      }
    }

    session.state = 'SPEAKING';
    send(session, { type: 'state', state: 'SPEAKING' });

    const onGenSent = isFirstConsumerChunk ? () => {
      if (t_tts_generate_sent === null) t_tts_generate_sent = Date.now();
    } : undefined;

    const speakRes = await speakSentence(session, chunk, markFirstAudio, onGenSent);
    if (speakRes.pcmBytes) totalAudioPcmBytes += speakRes.pcmBytes;
    isFirstConsumerChunk = false;
    if (!speakRes.ok || session.ended || session.cancelGeneration) break;
  }

  // wait for llm to finish (if not cancelled)
  if (!session.cancelGeneration) {
    try { await llmPromise; } catch {}
  } else {
    controller.abort();
  }

  session.generating = false;
  session.abortController = null;

  if (session.cancelGeneration) {
    // Persist the partial agent reply as interrupted so the transcript and
    // summary reflect what the customer actually heard.
    const partialReply = fullReply.replace(/\[CALL_COMPLETE\]/gi, '').trim();
    if (partialReply) addTurn(session, 'agent', partialReply, true);
    return;
  }

  if (!session.ended) {
    const hasCallCompleteTag = /\[CALL_COMPLETE\]/i.test(fullReply);
    const cleanedText = fullReply.replace(/\[CALL_COMPLETE\]/gi, '').trim();
    const isFinal = isFinalClosingTurn(cleanedText, text, hasCallCompleteTag);

    if (cleanedText) addTurn(session, 'agent', cleanedText, false);

    if (isFinal) {
      const audioDurationMs = Math.round(totalAudioPcmBytes / 48);
      console.log(`[session ${session.id}] Final closing sign-off detected ("${cleanedText.slice(0, 60)}..."). Initiating call finalization.`);
      scheduleFinalization(session, 'assistant_ended', audioDurationMs);
    } else {
      setState(session, 'LISTENING');
    }
  }
}

export function scheduleFinalization(session: Session, reason: string, audioDurationMs = 0) {
  if (session.ended) return;
  session.finalizing = true;
  session.pendingEndReason = reason;
  setState(session, 'FINALIZING');

  // Signal client that the audio stream for the final turn has concluded
  send(session, { type: 'agent_audio_end', isFinal: true });

  // Bounded fallback: ensures call does not remain open forever if client playback_complete is lost
  // Audio playback is 100% protected: fallback timeout is generously after expected audio completion + 1s.
  const fallbackMs = Math.max(5000, audioDurationMs + 4000);
  if (session.fallbackTerminationTimer) clearTimeout(session.fallbackTerminationTimer);
  session.fallbackTerminationTimer = setTimeout(() => {
    session.fallbackTerminationTimer = null;
    if (!session.ended) {
      console.log(`[session ${session.id}] Playback completion acknowledgement not received within ${fallbackMs}ms; concluding call.`);
      void endSession(session, session.pendingEndReason || reason);
    }
  }, fallbackMs);
}

export function handlePlaybackComplete(session: Session) {
  if (session.ended || !session.finalizing) return;
  if (session.playbackCompleted) return;
  session.playbackCompleted = true;
  console.log(`[session ${session.id}] Client confirmed final playback complete. Waiting 1 second before terminating.`);

  // Cancel fallback timer since client confirmed playback completion
  if (session.fallbackTerminationTimer) {
    clearTimeout(session.fallbackTerminationTimer);
    session.fallbackTerminationTimer = null;
  }

  // Cancel any existing termination timer to prevent duplicates
  if (session.terminationTimer) {
    clearTimeout(session.terminationTimer);
    session.terminationTimer = null;
  }

  // Exactly 1 second after playback completes:
  session.terminationTimer = setTimeout(() => {
    session.terminationTimer = null;
    if (!session.ended) {
      void endSession(session, session.pendingEndReason || 'assistant_ended');
    }
  }, 1000);
}

export function bargeIn(session: Session) {
  if (session.ended || session.finalizing) return;
  session.cancelGeneration = true;
  session.generating = false;
  if (session.abortController) {
    try { session.abortController.abort(); } catch {}
  }
  try { session.tts.cancel(); } catch {}
  send(session, { type: 'stop_audio' });
  setState(session, 'LISTENING');
}

export function handleSocketDisconnect(session: Session) {
  if (session.ended) return;
  session.ws = null;
  if (session.finalizing) {
    console.log(`[session ${session.id}] Socket disconnected during finalization. Completing call immediately.`);
    if (session.terminationTimer) {
      clearTimeout(session.terminationTimer);
      session.terminationTimer = null;
    }
    if (session.fallbackTerminationTimer) {
      clearTimeout(session.fallbackTerminationTimer);
      session.fallbackTerminationTimer = null;
    }
    endSession(session, session.pendingEndReason || 'assistant_ended').catch(() => {});
    return;
  }
  if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
  // Give mid-call page reloads or transient network disconnects a 12-second grace period
  // to reconnect without terminating the ongoing call session.
  session.disconnectTimer = setTimeout(() => {
    session.disconnectTimer = null;
    if (!session.ended && !session.ws) {
      console.log(`[session ${session.id}] Disconnect grace period elapsed without reconnect. Ending call.`);
      endSession(session, 'disconnect').catch(() => {});
    }
  }, 12000);
}

export async function endSession(session: Session, reason: string) {
  if (session.ended) return;
  session.ended = true;
  session.finalizing = true;
  if (session.terminationTimer) {
    clearTimeout(session.terminationTimer);
    session.terminationTimer = null;
  }
  if (session.fallbackTerminationTimer) {
    clearTimeout(session.fallbackTerminationTimer);
    session.fallbackTerminationTimer = null;
  }
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }
  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  if (session.maxTimer) clearTimeout(session.maxTimer);
  if (session.keepAliveTimer) clearInterval(session.keepAliveTimer);
  session.cancelGeneration = true;
  session.generating = false;
  if (session.abortController) {
    try { session.abortController.abort(); } catch {}
  }

  setState(session, 'ENDING');
  try {
    db.prepare('UPDATE calls SET end_time=?, end_reason=?, latency_json=?, usage_json=? WHERE id=?')
      .run(new Date().toISOString(), reason, JSON.stringify(session.latencies), JSON.stringify(session.usage), session.id);
    if (session.missedCallId) {
      const status = reason === 'opted_out' ? 'opted_out' : 'done';
      db.prepare('UPDATE missed_calls SET status=? WHERE id=?').run(status, session.missedCallId);
    }
  } catch (dbErr) {
    console.error(`[session ${session.id}] Failed to persist call end:`, dbErr);
  }

  setState(session, 'SUMMARIZING');

  // Close provider connections before summary generation. A slow or hung LLM
  // must never keep the STT/TTS sockets or the session alive.
  const stt = session.stt;
  session.stt = null;
  if (stt) {
    try { await stt.close(); } catch {}
  }
  try { await session.tts.close(); } catch {}

  const transcript = session.turns.map((t: SessionTurn) => `${t.role === 'agent' ? 'Agent' : 'Customer'}: ${t.text}`).join('\n');
  const callContext: llm.CallContext = {
    phoneStatus: session.phoneStatus,
    verifiedCallerPhone: session.verifiedCallerPhone,
    collectedPhone: session.collectedPhone,
    turnCount: session.turns.filter((t: SessionTurn) => t.role === 'customer').length,
  };

  let parsed: llm.StructuredSummary | null = null;
  let raw = '';
  let summaryStatus: 'completed' | 'unavailable' = 'unavailable';
  try {
    const result = await withStageTimeout(
      llm.summarize(transcript, session.business, callContext),
      20000,
      'Summary generation'
    );
    parsed = result.parsed;
    raw = result.raw;
    summaryStatus = result.status;
  } catch (summaryErr) {
    const msg = summaryErr instanceof Error ? summaryErr.message : String(summaryErr);
    console.error(`[session ${session.id}] Summary generation failed:`, sanitizeErrorMsg(msg));
    raw = 'Summary generation failed or timed out.';
  }

  const summaryId = uuidv4();
  const isUnavailable = summaryStatus === 'unavailable' || !parsed;
  const finalStatus = isUnavailable ? 'unavailable' : 'completed';

  const summary = {
    id: summaryId,
    callId: session.id,
    reason: isUnavailable ? 'Summary unavailable' : parsed!.reason,
    urgency: isUnavailable ? '' : parsed!.urgency,
    preferred_time: isUnavailable ? 'not specified' : parsed!.preferred_time,
    contact_details: isUnavailable ? 'not provided' : parsed!.contact_details,
    suggested_action: isUnavailable ? 'Manual follow-up needed' : parsed!.suggested_action,
    short_summary: isUnavailable ? 'Structured summary could not be extracted.' : parsed!.short_summary,
    sentiment: isUnavailable ? '' : parsed!.sentiment,
    status: finalStatus,
  };

  try {
    db.prepare(`INSERT INTO summaries (id, call_id, reason, urgency, preferred_time, contact_details, suggested_action, short_summary, sentiment, raw, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(summaryId, session.id,
        summary.reason,
        summary.urgency,
        summary.preferred_time,
        summary.contact_details,
        summary.suggested_action,
        summary.short_summary,
        summary.sentiment,
        raw,
        finalStatus);
  } catch (dbErr) {
    console.error(`[session ${session.id}] Failed to persist summary:`, dbErr);
  }

  setState(session, 'DONE');
  send(session, { type: 'summary', summary });
  setTimeout(() => {
    try { session.ws?.close(); } catch {}
  }, 500);

  sessions.delete(session.id);

  // Public SSE carries only the call id. Phone numbers and tokens stay out of
  // broadcast payloads; the dashboard fetches details through its normal API.
  events.broadcast('call_ended', { callId: session.id });
  events.broadcast('summary_ready', { callId: session.id });

  // Fire-and-forget owner notification: send nothing if 0 customer turns, unless opted_out
  const customerTurns = (session.turns || []).filter((t: SessionTurn) => t.role === 'customer');
  const shouldNotify = customerTurns.length > 0 || reason === 'opted_out';

  if (shouldNotify && !session.notificationDispatched) {
    session.notificationDispatched = true;
    const resolvedCustomerPhone = (session.phoneStatus === 'validated' || session.phoneStatus === 'confirmed')
      ? (session.collectedPhone || session.customerPhone)
      : session.phoneStatus === 'verified'
        ? (session.verifiedCallerPhone || session.customerPhone)
        : (session.phoneStatus === 'declined' ? 'declined' : 'not provided');
    notifyCallSummary({
      callId: session.id,
      businessName: session.business?.name || 'Business',
      customerPhone: resolvedCustomerPhone,
      endReason: reason,
      summary,
    }).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[session] Owner notification dispatch error:', errMsg);
    });
  }
}

export function getSession(id: string) { return sessions.get(id); }

export function getAllSessions() { return Array.from(sessions.values()); }

export function getBusiness() { return rowToBiz(getBusinessRow()); }
