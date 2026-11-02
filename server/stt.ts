import WebSocket from 'ws';

const STT_URL = 'wss://streaming.assemblyai.com/v3/ws';

export interface SttOptions {
  apiKey: string;
  sampleRate?: number;
  speechModel?: string;
  minTurnSilence?: number;
  maxTurnSilence?: number;
  formatTurns?: boolean;
}

export type PartialCallback = (text: string) => void;
export type FinalTurnCallback = (
  text: string,
  words: Array<{ text?: string; start?: number; end?: number; confidence?: number }>,
  turnOrder?: number,
  confidence?: number,
  turnDetectionMs?: number | null
) => void;
export type SpeechStartCallback = (audioStartMs?: number) => void;
export type ErrorCallback = (err: Error) => void;
export type ReconnectingCallback = (attempt: number) => void;
export type ReconnectedCallback = () => void;

// 16kHz 16-bit mono PCM: 32 bytes = 1ms. 20ms = 640 bytes. 1000ms = 32000 bytes.
const MIN_CHUNK_BYTES = 640;
const MAX_CHUNK_BYTES = 32000;
const PREFERRED_CHUNK_BYTES = 1600; // 50ms chunks
// 1.5 seconds audio buffer for replay on reconnect (48,000 bytes)
const RECENT_AUDIO_BUFFER_LIMIT = 48000;

export function isFatalAuthOrParamError(code?: number, message?: string): boolean {
  const msg = (message || '').toLowerCase();
  // Concurrency or rate limits are retryable with backoff, even if text says "Unauthorized Connection: Too many concurrent sessions"
  if (msg.includes('concurrent') || msg.includes('rate limit') || msg.includes('too many') || msg.includes('allowance')) {
    return false;
  }
  if (code === 1008) {
    return true; // Fatal auth / policy rejection
  }
  if (code === 1007 || (typeof code === 'number' && code >= 4000 && code <= 4003)) {
    return true;
  }
  if (
    msg.includes('unauthorized') ||
    msg.includes('invalid api key') ||
    msg.includes('forbidden') ||
    msg.includes('insufficient funds') ||
    msg.includes('disabled key') ||
    msg.includes('invalid parameter') ||
    msg.includes('unknown parameter') ||
    msg.includes('unsupported sample rate') ||
    msg.includes('unsupported encoding')
  ) {
    return true;
  }
  return false;
}

export class SttClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private sampleRate: number;
  private speechModel: string;
  private minTurnSilence: number;
  private maxTurnSilence: number;
  private formatTurns: boolean;

  private connected = false;
  private connecting: Promise<void> | null = null;
  private closed = false;
  private isExplicitClose = false;

  private reconnectAttempts = 0;
  private isReconnecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  // Recent audio ring buffer for reconnect replay (1.5 seconds)
  private recentAudioBuffer: Buffer[] = [];
  private recentAudioBytes = 0;

  // Chunk duration normalization buffer (ensures frames sent to AAI are >= 20ms / 640 bytes)
  private pendingChunkBuffer: Buffer = Buffer.alloc(0);

  private partialCallback?: PartialCallback;
  private finalTurnCallback?: FinalTurnCallback;
  private speechStartCallback?: SpeechStartCallback;
  private errorCallback?: ErrorCallback;
  private closeCallback?: () => void;
  private reconnectingCallback?: ReconnectingCallback;
  private reconnectedCallback?: ReconnectedCallback;

  private totalAudioBytesSent = 0;

  constructor(opts: SttOptions) {
    this.apiKey = opts.apiKey;
    this.sampleRate = opts.sampleRate ?? 16000;
    this.speechModel = opts.speechModel ?? 'universal-3-6-pro';
    this.minTurnSilence = opts.minTurnSilence ?? 128;
    this.maxTurnSilence = opts.maxTurnSilence ?? 1000;
    this.formatTurns = opts.formatTurns ?? true;
  }

  private buildUrl(): string {
    const params = new URLSearchParams();
    params.set('speech_model', this.speechModel);
    params.set('sample_rate', String(this.sampleRate));
    params.set('encoding', 'pcm_s16le');
    params.set('format_turns', String(this.formatTurns));
    if (this.minTurnSilence !== undefined) {
      params.set('min_turn_silence', String(this.minTurnSilence));
    }
    if (this.maxTurnSilence !== undefined) {
      params.set('max_turn_silence', String(this.maxTurnSilence));
    }
    return `${STT_URL}?${params.toString()}`;
  }

  onPartial(cb: PartialCallback) {
    this.partialCallback = cb;
  }

  onFinalTurn(cb: FinalTurnCallback) {
    this.finalTurnCallback = cb;
  }

  onSpeechStart(cb: SpeechStartCallback) {
    this.speechStartCallback = cb;
  }

  onError(cb: ErrorCallback) {
    this.errorCallback = cb;
  }

  onClose(cb: () => void) {
    this.closeCallback = cb;
  }

  onReconnecting(cb: ReconnectingCallback) {
    this.reconnectingCallback = cb;
  }

  onReconnected(cb: ReconnectedCallback) {
    this.reconnectedCallback = cb;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = this.buildUrl();
      const ws = new WebSocket(url, { headers: { Authorization: this.apiKey } });
      this.ws = ws;

      const connectTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.terminate(); } catch {}
          reject(new Error('AssemblyAI STT connection handshake timed out after 10000ms'));
        }
      }, 10000);

      ws.on('open', () => {
        // Transport connection established; wait for Begin message
      });

      ws.on('message', (data: WebSocket.RawData) => {
        let msg: {
          type?: string;
          error?: string;
          error_code?: string | number;
          text?: string;
          words?: Array<{ text?: string; start?: number; end?: number; confidence?: number }>;
          [key: string]: unknown;
        };
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (msg.type === 'Begin') {
          clearTimeout(connectTimeout);
          this.connected = true;
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        if (msg.type === 'SpeechStarted') {
          this.speechStartCallback?.(msg.audio_start_ms);
          return;
        }

        if (msg.type === 'Turn') {
          const transcript = (msg.transcript || '').trim();
          if (msg.end_of_turn) {
            this.clearRecentAudio();
            const totalAudioMs = Math.round(this.totalAudioBytesSent / 32);
            let turnDetectionMs: number | null = null;
            if (Array.isArray(msg.words) && msg.words.length > 0) {
              const lastWord = msg.words[msg.words.length - 1];
              if (typeof lastWord.end === 'number') {
                turnDetectionMs = Math.max(0, totalAudioMs - lastWord.end);
              }
            }
            this.finalTurnCallback?.(
              transcript,
              msg.words || [],
              msg.turn_order,
              msg.end_of_turn_confidence,
              turnDetectionMs
            );
          } else {
            this.partialCallback?.(transcript);
          }
          return;
        }

        if (msg.type === 'Error') {
          const errMsg = `AssemblyAI STT error: ${msg.error || JSON.stringify(msg)}`;
          const err = new Error(errMsg);
          if (!settled) {
            clearTimeout(connectTimeout);
            settled = true;
            reject(err);
          } else {
            this.handleSocketFailure(errMsg);
          }
          return;
        }

        if (msg.type === 'Termination') {
          this.closed = true;
          this.connected = false;
          this.closeCallback?.();
          return;
        }
      });

      ws.on('error', (err: Error) => {
        if (!settled) {
          clearTimeout(connectTimeout);
          settled = true;
          reject(err);
        } else {
          this.handleSocketFailure(err.message);
        }
      });

      ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(connectTimeout);
        this.connected = false;
        if (!settled) {
          settled = true;
          const reasonStr = reason?.toString() || '';
          reject(new Error(`AssemblyAI STT closed before Begin: code ${code} (${reasonStr})`));
          return;
        }
        if (!this.closed && !this.isExplicitClose) {
          this.handleSocketFailure(`Socket closed unexpectedly (code: ${code}, reason: ${reason?.toString()})`, code);
        } else {
          this.closeCallback?.();
        }
      });
    });
  }

  private handleSocketFailure(reason: string, code?: number): void {
    if (this.closed || this.isExplicitClose) return;

    if (isFatalAuthOrParamError(code, reason)) {
      this.closed = true;
      this.connected = false;
      this.cleanupWs();
      this.errorCallback?.(new Error(`AssemblyAI STT fatal error: ${reason}`));
      return;
    }

    this.triggerReconnect(reason);
  }

  private triggerReconnect(reason: string): void {
    if (this.closed || this.isExplicitClose) return;
    if (this.isReconnecting) return;

    if (this.reconnectAttempts >= 2) {
      this.closed = true;
      this.connected = false;
      this.cleanupWs();
      this.errorCallback?.(
        new Error(`AssemblyAI STT reconnect exhausted after 2 attempts. Last error: ${reason}`)
      );
      return;
    }

    this.isReconnecting = true;
    this.connected = false;
    this.cleanupWs();

    const attempt = ++this.reconnectAttempts;
    const delay = attempt === 1 ? 250 : 750;

    console.log(`[SttClient] Triggering STT reconnect attempt ${attempt}/2 in ${delay}ms (reason: ${reason})`);
    this.reconnectingCallback?.(attempt);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.closed || this.isExplicitClose) return;

      try {
        await this.doConnect();
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.totalAudioBytesSent = 0;

        console.log(`[SttClient] Reconnected to AssemblyAI STT successfully. Replaying recent audio...`);
        await this.replayRecentAudio();
        this.flushPendingChunks();

        this.reconnectedCallback?.();
      } catch (err: unknown) {
        this.isReconnecting = false;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (isFatalAuthOrParamError(undefined, errMsg)) {
          this.closed = true;
          this.errorCallback?.(err instanceof Error ? err : new Error(errMsg));
          return;
        }
        this.triggerReconnect(errMsg || 'Reconnect connection failed');
      }
    }, delay);
  }

  private appendRecentAudio(buf: Buffer): void {
    this.recentAudioBuffer.push(buf);
    this.recentAudioBytes += buf.length;
    while (this.recentAudioBytes > RECENT_AUDIO_BUFFER_LIMIT && this.recentAudioBuffer.length > 1) {
      const removed = this.recentAudioBuffer.shift()!;
      this.recentAudioBytes -= removed.length;
    }
  }

  clearRecentAudio(): void {
    this.recentAudioBuffer = [];
    this.recentAudioBytes = 0;
  }

  private async replayRecentAudio(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.recentAudioBuffer.length === 0) return;

    const toReplay = this.recentAudioBuffer;
    this.recentAudioBuffer = [];
    this.recentAudioBytes = 0;

    const combined = Buffer.concat(toReplay);
    if (combined.length === 0) return;

    for (let offset = 0; offset < combined.length; offset += PREFERRED_CHUNK_BYTES) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) break;
      let chunk = combined.subarray(offset, Math.min(offset + PREFERRED_CHUNK_BYTES, combined.length));
      if (chunk.length < MIN_CHUNK_BYTES) {
        const padded = Buffer.alloc(MIN_CHUNK_BYTES);
        chunk.copy(padded);
        chunk = padded;
      }
      this.sendRawChunk(chunk);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private flushPendingChunks(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    while (this.pendingChunkBuffer.length >= MIN_CHUNK_BYTES) {
      let sliceSize = Math.min(this.pendingChunkBuffer.length, PREFERRED_CHUNK_BYTES);
      const remainder = this.pendingChunkBuffer.length - sliceSize;
      if (remainder > 0 && remainder < MIN_CHUNK_BYTES) {
        if (this.pendingChunkBuffer.length <= MAX_CHUNK_BYTES) {
          sliceSize = this.pendingChunkBuffer.length;
        }
      }

      const chunk = this.pendingChunkBuffer.subarray(0, sliceSize);
      this.pendingChunkBuffer = this.pendingChunkBuffer.subarray(sliceSize);
      this.sendRawChunk(chunk);
    }
  }

  private sendRawChunk(chunk: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.totalAudioBytesSent += chunk.length;
    try {
      this.ws.send(chunk, { binary: true });
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.handleSocketFailure(errMsg || 'Send audio error');
    }
  }

  async connectWithRetry(): Promise<void> {
    this.closed = false;
    this.isExplicitClose = false;
    this.reconnectAttempts = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.connect();
        return;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (isFatalAuthOrParamError(undefined, errMsg)) {
          throw err;
        }
        if (attempt === 3) {
          throw err;
        }
        const delay = attempt === 1 ? 500 : 1500;
        console.log(`[SttClient] Initial connect attempt ${attempt} failed (${errMsg}). Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  sendAudio(data: Buffer | Uint8Array | ArrayBuffer): void {
    if (this.closed) return;
    const buf = Buffer.isBuffer(data)
      ? data
      : data instanceof Uint8Array
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : Buffer.from(data);

    if (buf.length === 0) return;

    this.appendRecentAudio(buf);

    if (this.isReconnecting || !this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.pendingChunkBuffer = Buffer.concat([this.pendingChunkBuffer, buf]);
    this.flushPendingChunks();
  }

  forceDisconnectForTesting(): void {
    if (this.ws) {
      console.log('[SttClient] Force disconnecting upstream STT WebSocket for testing');
      try {
        const sock = (this.ws as unknown as { _socket?: { destroy: (e?: Error) => void } })._socket;
        if (sock && typeof sock.destroy === 'function') {
          sock.destroy(new Error('ECONNRESET: connection reset by peer'));
        } else {
          this.ws.close(1006, 'forced_disconnect');
        }
      } catch {}
      this.handleSocketFailure('Forced disconnect for testing');
    }
  }

  private cleanupWs(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        const sock = (this.ws as unknown as { _socket?: { destroy: () => void } })._socket;
        if (sock && typeof sock.destroy === 'function') {
          sock.destroy();
        } else {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
    this.connected = false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.isExplicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.recentAudioBuffer = [];
    this.recentAudioBytes = 0;
    this.pendingChunkBuffer = Buffer.alloc(0);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'Terminate' }));
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
      try {
        this.ws.close(1000);
      } catch {}
    }
    this.cleanupWs();
  }
}
