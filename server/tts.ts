import WebSocket from 'ws';

const TTS_URL = 'wss://tts.us.assemblyai.com/v1/ws';

export interface TtsOptions {
  apiKey: string;
  voiceId: string;
  sampleRate?: number;
  encoding?: string;
  language?: string;
}

export class TtsClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private voiceId: string;
  private sampleRate: number;
  private encoding: string;
  private language: string;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private reconnectAttempted = false;
  private cancelled = false;
  private generation = 0;
  private frameWaiters: Array<(f: any) => void> = [];
  private frameQueue: any[] = [];
  private closed = false;

  constructor(opts: TtsOptions) {
    this.apiKey = opts.apiKey;
    this.voiceId = opts.voiceId;
    this.sampleRate = opts.sampleRate ?? 24000;
    this.encoding = opts.encoding ?? 'pcm_s16le';
    this.language = opts.language ?? 'english';
  }

  private buildUrl() {
    const params = new URLSearchParams();
    params.set('voice_id', this.voiceId);
    params.set('sample_rate', String(this.sampleRate));
    params.set('encoding', this.encoding);
    params.set('language', this.language);
    return `${TTS_URL}?${params.toString()}`;
  }

  private pushFrame(f: any) {
    if (this.frameWaiters.length > 0) {
      const w = this.frameWaiters.shift()!;
      w(f);
    } else {
      this.frameQueue.push(f);
    }
  }

  private nextFrame(timeoutMs = 30000): Promise<any> {
    if (this.frameQueue.length > 0) {
      return Promise.resolve(this.frameQueue.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.frameWaiters.indexOf(wrapped);
        if (idx >= 0) this.frameWaiters.splice(idx, 1);
        reject(new Error('TTS frame timeout'));
      }, timeoutMs);
      const wrapped = (f: any) => {
        clearTimeout(timer);
        resolve(f);
      };
      this.frameWaiters.push(wrapped);
    });
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

      ws.on('message', (data: WebSocket.RawData) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (!this.connected && msg.type === 'Begin') {
          this.connected = true;
          if (!settled) { settled = true; resolve(); }
          return;
        }
        if (!this.connected && msg.type === 'Error') {
          if (!settled) { settled = true; reject(new Error(`TTS ${msg.error_code}: ${msg.error} (voice_id=${this.voiceId})`)); }
          return;
        }
        this.pushFrame(msg);
      });

      ws.on('open', () => {
        // wait for Begin
      });

      ws.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.connected = false;
      });

      ws.on('close', () => {
        this.connected = false;
        this.ws = null;
        // unblock any waiters
        while (this.frameWaiters.length) {
          const w = this.frameWaiters.shift()!;
          w({ type: 'Error', error_code: 1006, error: 'connection closed' });
        }
      });
    });
  }

  async connectWithRetry(): Promise<void> {
    try {
      await this.connect();
      this.reconnectAttempted = false;
    } catch (err) {
      if (!this.reconnectAttempted) {
        this.reconnectAttempted = true;
        // reset
        this.connected = false;
        this.ws = null;
        await this.connect();
        this.reconnectAttempted = false;
      } else {
        throw err;
      }
    }
  }

  async *speak(text: string, onGenerateSent?: () => void): AsyncGenerator<Uint8Array> {
    await this.connectWithRetry();
    this.cancelled = false;
    const myGen = ++this.generation;
    const ws = this.ws!;
    ws.send(JSON.stringify({ type: 'Generate', text }));
    if (onGenerateSent) {
      try { onGenerateSent(); } catch {}
    }
    ws.send(JSON.stringify({ type: 'Flush' }));

    let done = false;
    while (!done && !this.closed) {
      if (this.generation !== myGen) {
        // cancelled; stop yielding
        break;
      }
      let frame: any;
      try {
        frame = await this.nextFrame();
      } catch (e) {
        throw e;
      }
      if (!frame) break;
      if (this.generation !== myGen) break;
      switch (frame.type) {
        case 'Audio':
          if (this.cancelled || this.generation !== myGen) {
            // drop late audio after cancel
            break;
          }
          if (frame.audio) {
            const buf = Buffer.from(frame.audio, 'base64');
            yield new Uint8Array(buf);
          }
          break;
        case 'FlushDone':
          if (this.generation === myGen) done = true;
          break;
        case 'Cancelled':
          this.cancelled = true;
          done = true;
          break;
        case 'Error':
          throw new Error(`${frame.error_code}: ${frame.error}`);
        case 'Termination':
          this.closed = true;
          done = true;
          break;
        default:
          break;
      }
    }
  }

  cancel() {
    this.cancelled = true;
    this.generation++; // invalidate in-flight speak
    this.frameQueue = []; // drop buffered frames from cancelled utterance
    while (this.frameWaiters.length) {
      const w = this.frameWaiters.shift()!;
      w({ type: 'Cancelled' });
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'Cancel' })); } catch {}
    }
  }

  keepAlive() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'KeepAlive' })); } catch {}
    }
  }

  async close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify({ type: 'Terminate' })); } catch {}
    }
    // wait briefly for termination
    await new Promise((r) => setTimeout(r, 200));
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connected = false;
  }
}
