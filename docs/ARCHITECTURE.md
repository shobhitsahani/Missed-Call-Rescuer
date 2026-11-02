# Missed-Call Rescuer — System Architecture & Implementation Summary

## 1. Executive Summary

Missed-Call Rescuer is an automated voice callback agent for small service businesses. When a call is missed, the system records the missed call and provides a callback URL (`/call/{id}`). The voice assistant greets the caller, confirms caller intent, handles barge-in interruptions, and records a structured summary for the business owner dashboard.

For measured latency benchmarks (Turn Detection, Time-to-First-Token, Time-to-First-Audio, and total time to first audio byte), see the [Latency section of README.md](file:///c:/projects/Missed-Call-Rescuer/README.md#latency).

---

## 2. High-Level System Architecture

```mermaid
flowchart TD
    subgraph Browser ["Client Tier (Browser)"]
        UI_Dash["Owner Dashboard (/page.tsx)"]
        UI_Call["Customer Call Page (/call/[token]/page.tsx)"]
        Worklet["AudioWorklet (16 kHz PCM Downsampler)"]
        WebAudio["Web Audio API (24 kHz PCM Playback)"]
    end

    subgraph Server ["Application Server (Node.js/Express: 4000)"]
        HTTP["HTTP API Routes (/index.ts)"]
        WS_Server["WebSocket Server (/ws)"]
        SSE_Broker["SSE Event Broker (/events.ts)"]
        Session["Session State Machine (/session.ts)"]
        STT_Client["AssemblyAI STT Client (/stt.ts)"]
        TTS_Client["AssemblyAI TTS Client (/tts.ts)"]
        EarlyChunk["Early Clause & Word Chunking Buffer"]
    end

    subgraph External ["External AI Services"]
        LLM["Groq API (qwen/qwen3.8-27b)"]
        AAI_STT["AssemblyAI Streaming STT (v3 WebSocket: universal-3-6-pro)"]
        AAI_TTS["AssemblyAI Streaming TTS (v1 WebSocket: assemblyai-tts-1)"]
    end

    subgraph Storage ["Persistence Layer"]
        DB[(SQLite / better-sqlite3: data/app.db)]
    end

    UI_Call <--> |WebSocket JSON & 16kHz PCM (Mic)| WS_Server
    WS_Server --> |Binary 16kHz PCM| STT_Client
    STT_Client <--> |WebSocket| AAI_STT
    STT_Client --> |Partials & Final Turns| Session
    UI_Dash <--> |SSE Stream (/api/events)| SSE_Broker
    HTTP --> DB
    WS_Server --> Session
    Session --> EarlyChunk
    EarlyChunk --> LLM
    EarlyChunk --> TTS_Client
    TTS_Client <--> |WebSocket| AAI_TTS
    TTS_Client --> |24kHz PCM Playback| WS_Server
    Session --> DB
    Session --> SSE_Broker
```

---

## 3. Core Component Breakdown

### 3.1. Express Server & WebSocket Routing ([`server/index.ts`](file:///c:/projects/Missed-Call-Rescuer/server/index.ts))
- Runs on port 4000 (configurable via `PORT` environment variable).
- **Authentication & Security**:
  - `POST /api/auth`: Verifies `ACCESS_CODE` in constant time, rate-limited to 5/min per IP, returns a 12-hour HMAC signed JWT token.
  - `GET /api/call-token/:token`: Public unauthenticated validation for customer callback links (validates 128-bit random token, 30-minute expiry, and single-use).
  - `GET /api/events/token`: Generates a short-lived (60s) single-use stream token for EventSource SSE connectivity.
  - `POST /api/admin/clear-test-data`: Authenticated test and demo data clearing action (requires `ADMIN_ENABLED=true` in production).
  - Protected API routes require `Authorization: Bearer <token>`.
  - Strict CORS origin validation and WebSocket upgrade origin checks.
- **REST Endpoints**:
  - `GET /api/business`: Returns the configured business profile plus active `sttProvider`.
  - `GET /api/missed-calls`: Returns missed calls ordered by time descending.
  - `POST /api/missed-calls/simulate`: Creates a missed call record with an unguessable 128-bit hex token, queues a row in `callback_jobs`, and broadcasts a `missed_call` SSE event.
  - `GET /api/calls`: Returns calls ordered by start time with honest completion calculation (`is_completed`), parsed `latency`, and `usage` JSON.
  - `GET /api/calls/:id`: Returns single call record, dialogue turns, and summary.
  - `GET /api/calls/:id/transcript`: Downloads full transcript in formatted TXT or JSON.
  - `GET /api/summaries/:callId`: Returns summary record for a call.
  - `POST /api/notify/test`: Sends a test notification to the configured owner channel (Telegram or Discord).
  - `POST /api/calls/:id/notify`: Re-triggers owner notification for a specific call (rate limited to 1 per 30s per call).
  - `GET /api/events`: Server-Sent Events (SSE) stream for real-time dashboard updates.
  - `GET /api/health`: Healthcheck endpoint returning `{ ok: true }`.
- **WebSocket Upgrade (`/ws`)**:
  - Attached to the HTTP server for `/ws` connections, with strict Origin validation in production and join rate limiting (10/min/IP).
  - Incoming client messages:
    - `{ type: "join", token: string, missedCallId: string }`
    - `{ type: "transcript", final: true, text: string }` (browser fallback)
    - `{ type: "barge_in" }`
    - `{ type: "end", reason?: string }`
    - Binary frames: raw 16 kHz linear PCM microphone chunks from the browser's `AudioWorklet`, forwarded directly to `session.stt.sendAudio()`.
  - Outgoing server messages:
    - `{ type: "config", sttProvider: string }`
    - `{ type: "state", state: string }`
    - `{ type: "partial", text: string }`: live partial transcripts from AssemblyAI STT.
    - `{ type: "customer_transcript", text: string }`: final turn customer transcript.
    - `{ type: "agent_text", text: string }`
    - `{ type: "stop_audio" }`
    - `{ type: "metrics", totalMs, turnDetectionMs, llmFirstTokenMs, ttsFirstAudioMs, timeToFirstAudio }`
    - `{ type: "summary", summary: object }`
    - `{ type: "error", message: string }`
    - Binary frames: raw 24 kHz linear PCM chunks (`Uint8Array`) for agent speech playback.

### 3.2. Session State Machine & Orchestrator ([`server/session.ts`](file:///c:/projects/Missed-Call-Rescuer/server/session.ts))
- **State Machine**:
  - States: `GREETING`, `SPEAKING`, `LISTENING`, `THINKING`, `ENDING`, `SUMMARIZING`, `DONE`.
  - Start: `GREETING` -> `SPEAKING` (speaks greeting) -> `LISTENING`.
  - Turn execution: `LISTENING` -> `THINKING` (LLM streaming) -> `SPEAKING` (first audio chunk arrives) -> `LISTENING` (turn finished).
  - Barge-in: `SPEAKING` or `THINKING` -> `LISTENING` (generation canceled, audio halted).
  - Termination: `ENDING` -> `SUMMARIZING` -> `DONE`.
- **Timers & Limits**:
  - Hard session timeout: 5 minutes (`session.maxTimer = setTimeout(() => endSession(session, 'timeout'), 5 * 60 * 1000)`).
  - Closes AssemblyAI STT and TTS sessions cleanly on call end, socket close, or timeout.
  - TTS keep-alive: 30 seconds (`session.keepAliveTimer = setInterval(..., 30000)`).
- **Concurrency & Pacing**:
  - Drops incoming utterances while `generating = true` to prevent overlapping responses.
- **Persistence Deferral**:
  - Customer turn inserts into `turns` are deferred to the next event-loop turn using `setImmediate` (`deferDb = true`) to avoid blocking LLM initiation.

### 3.3. AssemblyAI Streaming STT Client ([`server/stt.ts`](file:///c:/projects/Missed-Call-Rescuer/server/stt.ts))
- Endpoint: `wss://streaming.assemblyai.com/v3/ws?speech_model=universal-3-6-pro&sample_rate=16000&encoding=pcm_s16le&format_turns=true&min_turn_silence=128&max_turn_silence=1000`.
- **Authentication**: Sent in WebSocket connection headers using `Authorization: <ASSEMBLYAI_API_KEY>` (no `Bearer ` prefix).
- **Audio Format**: 16 kHz mono 16-bit little-endian PCM (`pcm_s16le`), streamed in ~50 ms (1,600 byte) frames.
- **Turn Detection**:
  - Receives `Turn` messages with `end_of_turn: false` (interim partials) and `end_of_turn: true` (finalized turns).
  - Word-level timestamps (`words` array) provide `lastWord.end`, allowing precise measurement of `turnDetectionMs` (`totalAudioMs - lastWord.end`).
- **Clean Termination**: Emits `{ type: "Terminate" }` on session close to avoid idle billing.

### 3.4. AssemblyAI Streaming TTS Client ([`server/tts.ts`](file:///c:/projects/Missed-Call-Rescuer/server/tts.ts))
- Endpoint: `wss://tts.us.assemblyai.com/v1/ws`.
- Voice: `aai-jane` (or `ASSEMBLYAI_VOICE_ID`), 24 kHz sample rate, 16-bit linear PCM (`pcm_s16le`), English.
- **Protocol**:
  - Sends `{ type: "Generate", text }` followed by `{ type: "Flush" }`.
  - Receives base64-encoded `Audio` frames and converts them to binary buffers.
  - Sends `{ type: "Cancel" }` on barge-in to stop synthesis and drop queued frames.
  - Sends periodic `{ type: "KeepAlive" }` frames.
  - Includes single-attempt reconnection logic on connection loss.

### 3.5. LLM Integration & Summarization ([`server/llm.ts`](file:///c:/projects/Missed-Call-Rescuer/server/llm.ts))
- Provider: OpenAI-compatible client targeted at Groq (`https://api.groq.com/openai/v1`).
- Configured model: `qwen/qwen3.8-27b` (via `OPENAI_MODEL`).
- System constraints:
  - Agent introduces itself as automated.
  - Replies restricted to one sentence under 20 words.
  - Answers strictly from business profile (hours, services, FAQs).
  - Prohibits quoting unconfirmed prices or booking commitments.
- **Structured JSON Summarization**:
  Extracts 7 fields on call completion matching the `summaries` schema:
  ```json
  {
    "reason": "string",
    "urgency": "low | medium | high",
    "preferred_time": "string",
    "contact_details": "string",
    "suggested_action": "string",
    "short_summary": "string",
    "sentiment": "positive | neutral | negative"
  }
  ```

### 3.6. Persistence Layer ([`server/db.ts`](file:///c:/projects/Missed-Call-Rescuer/server/db.ts))
- SQLite using `better-sqlite3` located at `data/app.db`.
- Configured with `WAL` journal mode and foreign keys enabled.
- **Tables**:
  - `businesses`: Business profile (`id`, `name`, `hours`, `services`, `faqs`, `tone`, `voice`, `language`, `owner_email`).
  - `missed_calls`: Inbound missed calls (`id`, `business_id`, `customer_phone`, `time`, `status`). Status values: `new`, `queued`, `calling`, `done`, `opted_out`.
  - `callback_jobs`: Queue rows (`id`, `missed_call_id`, `attempts`, `schedule`, `state`, `last_error`). Rows are recorded upon simulated missed call, but no background scheduler or worker processes them yet.
  - `calls`: Call sessions (`id`, `missed_call_id`, `business_id`, `customer_phone`, `start_time`, `end_time`, `end_reason`, `latency_json`, `usage_json`, `notified_at`, `notify_status`, `notify_provider`, `notify_error`).
  - `turns`: Turn history (`id`, `call_id`, `order_idx`, `role`, `text`, `interrupted`, `ts`).
  - `summaries`: Extracted summary linked 1:1 to `calls` (`id`, `call_id`, `reason`, `urgency`, `preferred_time`, `contact_details`, `suggested_action`, `short_summary`, `sentiment`, `raw`).

### 3.6. Owner Notification Service ([`server/notify.ts`](file:///c:/projects/Missed-Call-Rescuer/server/notify.ts))
- Supported providers: `telegram` (Telegram Bot API `sendMessage`), `discord` (Discord Execute Webhook), or `none` (default).
- Dispatches immediately after summary persistence and SSE broadcast as a fire-and-forget background task.
- Plain-text message format containing call outcome, urgency, business name, masked customer phone, structured summary points, and a direct dashboard link (`?call={id}`).
- Reliability: 5-second HTTP timeout with 1 automatic retry on network errors or 5xx server responses; wraps all errors to never throw or block voice call lifecycle.
- Privacy & Idempotency: Masks customer phone numbers (middle digits replaced with asterisks), sanitizes bot tokens from logs/responses, and prevents duplicate dispatches.

---

## 4. Latency Breakdown & Pipeline Timing

The primary latency metric is strictly defined as the **time from arrival of the end-of-turn event to the first playable audio byte**. Turn detection delay is tracked and presented separately.

For the verified 3-run latency benchmark table and methodology, refer directly to the [Latency section of README.md](file:///c:/projects/Missed-Call-Rescuer/README.md#latency--turnaround-time).

### Measured Turn Latency Stages (3-Run Verified Average across 15 turns)

```
0 ms ── Customer stops speaking
  │
  ├─ 0 to 289 ms (289 ms): AssemblyAI STT Turn Detection (endpointing silence threshold)
  │                         [t_turn_end timestamp marked on end_of_turn: true]
  │
  ├─ 289 to 1645 ms (1356 ms): LLM TTFT (Groq streams first clause / 6 words)
  │
  └─ 1645 to 2036 ms (365 ms): AssemblyAI TTS first audio chunk delivered to browser
                              │
                            1747 ms Processing Pipeline (t_turn_end to first audio byte)
                            2036 ms End-to-End Turnaround Time
```

- **Early Chunking ([`extractNextChunk`](file:///c:/projects/Missed-Call-Rescuer/server/session.ts))**: First chunk is dispatched to TTS when punctuation (`,`, `;`, `:`, `—`, `--`, `.`, `!`, `?`) occurs OR at least 6 words (`FIRST_CHUNK_MIN_WORDS`) are collected. Subsequent chunks split on sentence punctuation (`.`, `!`, `?`).
- **Deferred Persistence**: SQLite writes for customer turns are deferred to the next event-loop turn (`setImmediate`) to keep database I/O off the critical turn path.

---

## 5. Barge-In & Safety Handling

### 5.1. Server-Side Barge-In with Self-Speech Filter
The system moves barge-in detection to the server ([`server/session.ts`](file:///c:/projects/Missed-Call-Rescuer/server/session.ts)):
1. **Word Threshold**: At least 2 words in the AssemblyAI partial transcript.
2. **Time Guard**: At least 400 ms since agent speech began.
3. **Self-Speech Filter**: Jaccard word-overlap similarity check between the interim transcript and the agent's current spoken text. If similarity exceeds 0.6, the utterance is treated as speaker feedback/echo and ignored.
4. **Immediate Cancellation**: When barge-in triggers, the server sends `{ type: "stop_audio" }` to the client, cancels TTS synthesis (`Cancel`), aborts the in-flight LLM stream (`AbortController`), and marks the current agent turn as `interrupted = 1`.

### 5.2. Safety Controls & Call Termination
- **Automated Disclosure**: Assistant greeting states it is an automated assistant calling on behalf of the business.
- **Opt-Out**: Detects opt-out phrases (`stop calling`, `do not call`, `remove me`, `opt out`, etc.). The agent confirms termination, ends the call with reason `opted_out`, and writes `status = 'opted_out'` to the `missed_calls` record.
- **Wrong Number Detection**: Detects wrong-number phrases (`wrong number`, `not the right person`, `you have the wrong`). The agent apologizes, speaks a goodbye reply, and calls `endSession(session, 'wrong_number')`. The call record stores `end_reason = 'wrong_number'`, while the missed call record status is set to `'done'`.

---

## 6. Frontend Applications

### 6.1. Business Owner Dashboard ([`src/app/page.tsx`](file:///c:/projects/Missed-Call-Rescuer/src/app/page.tsx))
- Built with Next.js 16.4.3 (App Router).
- Connects to `/api/events` via Server-Sent Events to automatically reload on `missed_call`, `call_ended`, and `summary_ready`.
- Button to trigger `POST /api/missed-calls/simulate`.
- Displays missed calls and status badges (`new`, `queued`, `calling`, `done`, `opted_out`).
- Displays call list with latency metrics in milliseconds (Total time, Turn detection, LLM TTFT, and TTS TTFA) and structured summary cards.

### 6.2. Customer Call Page ([`src/app/call/[token]/page.tsx`](file:///c:/projects/Missed-Call-Rescuer/src/app/call/%5Btoken%5D/page.tsx))
- Microphone capture via `getUserMedia` routed through `AudioWorklet` ([`public/audio-processor.js`](file:///c:/projects/Missed-Call-Rescuer/public/audio-processor.js)).
- Downsamples client audio to 16 kHz mono 16-bit signed PCM and streams chunks over the WebSocket.
- Renders live partial transcripts as words are spoken.
- Web Audio API `AudioContext` scheduled at 24 kHz for sequential linear PCM playback.
- Displays live dialogue transcript, real-time latency indicators, and call summaries upon completion.
