# Missed-Call Rescuer

Small shops lose customers to missed calls. Missed-Call Rescuer calls them back with a voice agent, finds out what they wanted, and gives the owner a structured summary.

## Demo

- **Demo Video**: [Watch the 1-minute walkthrough](TODO_ADD_VIDEO_URL) *(paste your YouTube / Loom link here)*

### Dashboard Interface
![Owner Dashboard](public/dashboard.png)

### Customer Call Interface
![Customer Call Interface](public/call-interface.png)

## What It Does

1. A missed call is simulated or recorded for the business.
2. The customer receives a callback link (`/call/{id}`).
3. The voice assistant greets the caller and explicitly discloses that it is an automated assistant.
4. The customer speaks naturally with the assistant, with real-time barge-in support to interrupt at any point.
5. When the call ends, a structured summary (reason, urgency, preferred callback time, contact details, suggested action, sentiment) appears live on the owner dashboard via Server-Sent Events.

## Try It

1. Open the owner dashboard at `http://localhost:3010`.
2. Click "Simulate missed call" to generate a callback task.
3. Open the generated callback link (`/call/{id}`) in any modern browser.
4. Put on headphones (recommended to avoid microphone echo feedback) and click "Start call" (allow microphone access).
5. Listen to the automated greeting, then speak naturally (e.g., "My pipe is leaking under the sink").
6. Test barge-in: speak while the agent is talking to verify instant audio cutoff.
7. Test opt-out: say "Stop calling me" to verify polite call termination, then return to `http://localhost:3010` to view the live structured summary and latency metrics.

## How It Uses AssemblyAI

Missed-Call Rescuer integrates AssemblyAI for both speech recognition and voice synthesis over secure, low-latency WebSocket connections:

### 1. Streaming Speech-to-Text (v3 WebSocket API)
- **Endpoint & Model**: Connects server-to-server to `wss://streaming.assemblyai.com/v3/ws` using the low-latency real-time model `universal-3-6-pro`.
- **Audio Capture & Worklet**: The browser captures microphone audio via `getUserMedia` (with echo cancellation, noise suppression, and auto gain control) and processes it inside a dedicated `AudioWorklet` ([public/audio-processor.js](public/audio-processor.js)). Audio is downsampled to 16 kHz mono signed 16-bit little-endian PCM (`pcm_s16le`) and streamed in 50 ms chunks (1,600 bytes) over WebSocket to the server.
- **Server Orchestration**: [server/stt.ts](server/stt.ts) (`SttClient`) authenticates with `Authorization: <ASSEMBLYAI_API_KEY>` (keys stay server-side) and streams the PCM frames.
- **Real-time Live Transcripts**: Partial transcripts (`Turn` with `end_of_turn: false`) are pushed to the browser over WebSocket for immediate live UI display.
- **Server-Side Barge-In**: Partial transcripts trigger instant barge-in if at least 2 words are detected after the agent has been speaking for ≥400 ms, filtered by a self-speech similarity guard. The server immediately halts TTS generation, aborts LLM completion, and emits `stop_audio` to the client.
- **Turn Detection & Endpointing**: When AssemblyAI emits `Turn` with `end_of_turn: true` (tuned with `min_turn_silence: 128` and `max_turn_silence: 1000`), the customer turn is finalized and dispatched to the LLM.

### 2. Streaming Text-to-Speech (`assemblyai-tts-1`)
- **Protocol**: Persistent WebSocket connection to `wss://tts.us.assemblyai.com/v1/ws`. The server streams JSON `Generate` and `Flush` commands. Decoded 24 kHz 16-bit linear PCM binary buffers are scheduled gaplessly in the browser using the Web Audio API.
- **Early Chunking**: The server flushes the first audio chunk to AssemblyAI TTS as soon as a clause boundary (`,`, `;`, `:`, `—`, `--`) or 6 words are generated, streaming subsequent text by sentence.

### 3. Provider Feature Flag
- Controlled via `STT_PROVIDER=assemblyai|browser` (defaults to `assemblyai`). If set to `browser`, the previous Web Speech API fallback remains available.

## Latency

Measured averages from automated 5-turn test runs with streaming PCM audio ([scripts/verify-pipeline.ts](scripts/verify-pipeline.ts)):

| Metric | Measured Average | Range | Description |
|---|---|---|---|
| Turn Detection (`turnDetectionMs`) | 389 ms | 304–454 ms | Delay from end of last customer word to AssemblyAI `end_of_turn: true` |
| LLM First Token (`llmFirstTokenMs`) | 320 ms | 282–384 ms | Time from `end_of_turn` message to first streamed LLM token from Groq (`qwen/qwen3.8-27b`) |
| TTS First Audio (`ttsFirstAudioMs`) | 368 ms | 352–373 ms | Time from `Generate` command to first audio chunk from AssemblyAI TTS |
| Total Processing Time (`totalMs`) | 711 ms | 661–768 ms | Time from `end_of_turn` arrival to first playable audio byte |

Notes on measurement:
- Total conversational turnaround time = Turn Detection Delay (~389 ms) + Processing Pipeline (~711 ms) ≈ ~1.10 s end-to-end voice turnaround.
- Turn detection delay is calculated directly from AssemblyAI word-level timing offsets (`totalAudioMs - lastWord.end`).
- Latency was measured over a transcontinental WebSocket connection to the AssemblyAI endpoint, paired with Groq (`qwen/qwen3.8-27b`). Real-world latency depends on user network location and chosen model.

## Architecture

```
[ Customer Call Page ] <====== WebSocket (JSON + 16kHz PCM) ======> [ Express API Server ]
  (AudioWorklet PCM)                                                 |   |
  (Web Audio Playback)                                               |   +---> AssemblyAI STT v3 (WebSocket)
                                                                     |   +---> AssemblyAI TTS v1 (WebSocket)
                                                                     |   +---> LLM API (Groq)
                                                                     |   +---> SQLite (better-sqlite3)
[ Owner Dashboard ]    <--- SSE & REST API --------------------------+
```

| File | Purpose |
|---|---|
| `public/audio-processor.js` | AudioWorkletProcessor downsampling microphone input to 16 kHz mono 16-bit PCM |
| `server/stt.ts` | AssemblyAI Streaming STT WebSocket client (`universal-3-6-pro`, turn detection) |
| `server/tts.ts` | AssemblyAI Streaming TTS WebSocket client (`Generate`, `Flush`, `Cancel`, `KeepAlive`) |
| `server/session.ts` | Call session state machine, early chunking buffer, server-side barge-in, turn tracking |
| `server/index.ts` | Express server, HTTP routes, SSE stream, binary PCM routing, and WebSocket handler |
| `server/llm.ts` | Streaming LLM completions, connection pooling, system prompts, structured JSON summarization |
| `server/db.ts` | SQLite database initialization, schemas, and queries |
| `server/events.ts` | Server-Sent Events broker for real-time dashboard events |
| `src/app/page.tsx` | Next.js owner dashboard displaying missed calls, live summaries, and latency averages |
| `src/app/call/[token]/page.tsx` | Customer call UI running AudioWorklet mic capture, live partial transcripts, and Web Audio playback |

Call state machine:
`GREETING` -> `SPEAKING` <-> `LISTENING` (via `THINKING`) -> `ENDING` -> `SUMMARIZING` -> `DONE`

## Safety and Behavior

- Disclosure: The agent explicitly discloses in its opening greeting that it is an automated assistant.
- Opt-Out and Wrong Numbers: Detects opt-out phrases ("stop calling", "remove me", "don't call") which mark the missed call record as `opted_out`. Detects wrong-number phrases ("wrong number", "not the right person") which end the call with reason `wrong_number` and mark the missed call `done`.
- Strict Bounds: The system prompt instructs the agent to answer only from the provided business configuration (hours, services, FAQs).
- No Promised Commitments: The agent never invents prices or promises appointment bookings, explicitly noting that the business owner will confirm.
- Conciseness: Responses are constrained to a single sentence under 20 words for fast conversational pacing.

## Setup

### Prerequisites
- Node.js 20 or higher
- Any modern web browser with Web Audio and AudioWorklet support (Chrome, Edge, Firefox, Safari)
- Headphones recommended (prevents microphone feedback from speaker audio triggering accidental barge-in)

### Installation
1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/shobhitsahani/Missed-Call-Rescuer.git
   cd Missed-Call-Rescuer
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

   Required environment variables in `.env`:
   - `ASSEMBLYAI_API_KEY`: AssemblyAI API key for Streaming STT and TTS
   - `ASSEMBLYAI_VOICE_ID`: Voice model ID (default: `aai-jane`)
   - `STT_PROVIDER`: STT provider mode (`assemblyai` or `browser`, default: `assemblyai`)
   - `OPENAI_API_KEY`: API key for LLM provider (default: Groq key)
   - `OPENAI_BASE_URL`: Base URL for OpenAI-compatible endpoint (default: `https://api.groq.com/openai/v1`)
   - `OPENAI_MODEL`: LLM model identifier (default: `qwen/qwen3.8-27b`)
   - `NEXT_PUBLIC_API_BASE`: API base URL for frontend (default: `http://localhost:4000`)
   - `PORT`: Express server port (default: `4000`)
   - `FIRST_CHUNK_MIN_WORDS`: Word threshold before flushing chunk 1 to TTS (default: `6`)

3. Start development servers:
   ```bash
   npm run dev
   ```
   Open the owner dashboard at `http://localhost:3010`.

### Benchmark Scripts
- Benchmark LLM Time-to-First-Token (5 runs):
  ```bash
  npx tsx scripts/llm-latency.ts
  ```
- Run automated end-to-end pipeline verification (5 turns via AssemblyAI STT, barge-in, opt-out):
  ```bash
  npx tsx scripts/verify-pipeline.ts
  ```

> Note: Any OpenAI-compatible endpoint works. Groq is the tested fast option using `qwen/qwen3.8-27b` (measured 311 ms average TTFT via `scripts/llm-latency.ts`). Free OpenRouter models were too slow for real-time voice (3 to 11+ second queue delays).

## Known Limitations

- Browser-only calls: Audio runs inside the browser using Web Audio and AudioWorklets; no PSTN or real telephony is connected.
- Single business: Database currently seeds a single business profile (`Acme Plumbing`).
- Session state: Call state is held in-memory on the active server process alongside SQLite records.
- Free-tier rate limits: Groq and AssemblyAI free tiers have concurrency and session rate limits, requiring modest spacing between rapid test calls.

## What's Next

- Telephony Integration: Connect Twilio or Telnyx SIP trunking to place real outbound phone calls.
- Multi-Tenant Support: Allow multiple businesses to register accounts and configure hours, services, and FAQs.
- Callback Scheduling: Background job queue to manage retry logic, scheduling windows, and business callback limits.

## License and Credits

- License: MIT License (see [LICENSE](LICENSE) file).
- Speech Recognition: Powered by AssemblyAI Streaming STT (`universal-3-6-pro`).
- Voice Synthesis: Powered by AssemblyAI Streaming TTS (`assemblyai-tts-1`).
