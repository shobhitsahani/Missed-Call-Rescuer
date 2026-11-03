/**
 * Structured, Production-Safe Diagnostic Logger for Missed-Call Rescuer
 * Provides correlation-ID tracking for complete voice session lifecycles.
 * Strict PII and credentials sanitization.
 */

export type LifecycleEvent =
  | 'session_requested'
  | 'token_created'
  | 'websocket_connecting'
  | 'websocket_open'
  | 'websocket_authenticated'
  | 'session_initialized'
  | 'assemblyai_connecting'
  | 'assemblyai_ready'
  | 'microphone_permission_granted'
  | 'audioworklet_ready'
  | 'audio_stream_started'
  | 'first_customer_audio_received'
  | 'first_transcript_received'
  | 'first_llm_response_received'
  | 'tts_started'
  | 'first_tts_audio_received'
  | 'assistant_audio_played'
  | 'websocket_closed'
  | 'assemblyai_closed'
  | 'session_terminated';

export type ErrorCategory =
  | 'auth'
  | 'network'
  | 'timeout'
  | 'provider'
  | 'audio'
  | 'lifecycle'
  | 'validation';

export type ErrorOrigin = 'browser' | 'backend' | 'external_provider';

export function sanitizeLogMessage(msg?: string): string {
  if (!msg) return '';
  return msg
    .replace(/(?:key|token|auth|bearer|secret)=[^\s&]+/gi, '$1=[redacted]')
    .replace(/(?:Bearer\s+)[^\s]+/gi, 'Bearer [redacted]')
    .replace(/wss?:\/\/[^\s]+/g, '[endpoint]')
    .slice(0, 300);
}

export function maskToken(token?: string | null): string {
  if (!token) return 'unknown';
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export interface LifecycleLogPayload {
  correlationId: string;
  event: LifecycleEvent;
  timestamp?: string;
  data?: Record<string, unknown>;
}

export interface FailureLogPayload {
  correlationId: string;
  category: ErrorCategory;
  origin: ErrorOrigin;
  message: string;
  state?: string;
  durationMs?: number;
  closeCode?: number;
  closeReason?: string;
  data?: Record<string, unknown>;
}

export function logLifecycle(payload: LifecycleLogPayload): void {
  const ts = payload.timestamp || new Date().toISOString();
  const entry = {
    level: 'INFO',
    type: 'lifecycle',
    timestamp: ts,
    correlationId: payload.correlationId,
    event: payload.event,
    ...(payload.data ? { data: payload.data } : {}),
  };
  console.log(JSON.stringify(entry));
}

export function logFailure(payload: FailureLogPayload): void {
  const ts = new Date().toISOString();
  const entry = {
    level: 'ERROR',
    type: 'failure',
    timestamp: ts,
    correlationId: payload.correlationId,
    category: payload.category,
    origin: payload.origin,
    message: sanitizeLogMessage(payload.message),
    state: payload.state || 'UNKNOWN',
    durationMs: payload.durationMs,
    closeCode: payload.closeCode,
    closeReason: payload.closeReason ? sanitizeLogMessage(payload.closeReason) : undefined,
    ...(payload.data ? { data: payload.data } : {}),
  };
  console.error(JSON.stringify(entry));
}
