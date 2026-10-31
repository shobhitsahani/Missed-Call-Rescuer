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
  words: any[],
  turnOrder?: number,
  confidence?: number,
  turnDetectionMs?: number | null
) => void;
export type SpeechStartCallback = (audioStartMs?: number) => void;
export type ErrorCallback = (err: Error) => void;

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
  private reconnectAttempted = false;
  private closed = false;

  private partialCallback?: PartialCallback;
  private finalTurnCallback?: FinalTurnCallback;
  private speechStartCallback?: SpeechStartCallback;
  private errorCallback?: ErrorCallback;
  private closeCallback?: () => void;

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

      ws.on('open', () => {
        // Transport connection established; wait for Begin message
      });

      ws.on('message', (data: WebSocket.RawData) => {
        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (msg.type === 'Begin') {
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
          const err = new Error(`AssemblyAI STT error: ${msg.error || JSON.stringify(msg)}`);
          if (!settled) {
            settled = true;
            reject(err);
          } else {
            this.errorCallback?.(err);
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
          settled = true;
          reject(err);
        } else {
          this.errorCallback?.(err);
        }
        this.connected = false;
      });

      ws.on('close', () => {
        this.connected = false;
        this.ws = null;
        this.closeCallback?.();
      });
    });
  }

  async connectWithRetry(): Promise<void> {
    try {
      await this.connect();
      this.reconnectAttempted = false;
    } catch (err: any) {
      if (!this.reconnectAttempted) {
        this.reconnectAttempted = true;
        this.connected = false;
        this.ws = null;
        await this.connect();
        this.reconnectAttempted = false;
      } else {
        throw err;
      }
    }
  }

  async reconnect(): Promise<void> {
    if (this.closed) return;
    this.connected = false;
    this.ws = null;
    await this.connectWithRetry();
  }

  sendAudio(data: Buffer | Uint8Array | ArrayBuffer): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = Buffer.isBuffer(data)
      ? data
      : data instanceof Uint8Array
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : Buffer.from(data);

    this.totalAudioBytesSent += buf.length;
    try {
      this.ws.send(buf, { binary: true });
    } catch (e: any) {
      this.errorCallback?.(e);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'Terminate' }));
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;
    this.connected = false;
  }
}
