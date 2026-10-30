# Missed-Call Rescuer — System Architecture & Implementation Summary

## 1. Executive Summary

Missed-Call Rescuer is an automated voice callback agent for small service businesses. When a call is missed, the system records the missed call and provides a callback URL (`/call/{id}`). The voice assistant greets the caller, confirms caller intent, handles barge-in interruptions, and records a structured summary for the business owner dashboard.

For measured latency benchmarks (Time-to-First-Token, Time-to-First-Audio, and total time to first audio byte), see the [Latency section of README.md](file:///c:/projects/Missed-Call-Rescuer/README.md#latency).

---

## 2. High-Level System Architecture

```mermaid
flowchart TD
    subgraph Browser ["Client Tier (Browser)"]
        UI_Dash["Owner Dashboard (/page.tsx)"]
        UI_Call["Customer Call Page (/call/[token]/page.tsx)"]
        WebSpeech["Web Speech API (STT)"]
        WebAudio["Web Audio API (24 kHz PCM Playback)"]
        BargeDetect["Self-Speech Filter"]
    end

    subgraph Server ["Application Server (Node.js/Express: 4000)"]
        HTTP["HTTP API Routes (/index.ts)"]
        WS_Server["WebSocket Server (/ws)"]
        SSE_Broker["SSE Event Broker (/events.ts)"]
        Session["Session State Machine (/session.ts)"]
        EarlyChunk["Early Clause & Word Chunking Buffer"]
    end

    subgraph External ["External AI Services"]
        LLM["Groq API (qwen/qwen3.8-27b)"]
        AAI["AssemblyAI Streaming TTS (WebSocket)"]
    end

    subgraph Storage ["Persistence Layer"]
        DB[(SQLite / better-sqlite3: data/app.db)]
    end

    UI_Call <--> |WebSocket JSON & Binary PCM| WS_Server
    UI_Dash <--> |SSE Stream (/api/events)| SSE_Broker
    HTTP --> DB
    WS_Server --> Session
    Session --> EarlyChunk
    EarlyChunk --> LLM
    EarlyChunk --> AAI
    Session --> DB
    Session --> SSE_Broker
```

---

## 3. Core Component Breakdown

### 3.1. Express Server & WebSocket Routing ([`server/index.ts`](file:///c:/projects/Missed-Call-Rescuer/server/index.ts))
- Runs on port 4000 (configurable via `PORT` environment variable).
- **REST Endpoints**:
  - `GET /api/business`: Returns the configured business profile.
  - `GET /api/missed-calls`: Returns missed calls ordered by time descending.
  - `POST /api/missed-calls/simulate`: Creates a missed call record (`mc_<timestamp>`), queues a row in `callback_jobs` (`job_<timestamp>`), updates missed call status to `queued`, and broadcasts a `missed_call` SSE event.
  - `GET /api/calls`: Returns calls ordered by start time with parsed `latency` and `usage` JSON.
  - `GET /api/calls/:id`: Returns single call record, dialogue turns, and summary.
  - `GET /api/summaries/:callId`: Returns summary record for a call.
  - `POST /api/notify/test`: Sends a test notification to the configured owner channel (Telegram or Discord).
  - `POST /api/calls/:id/notify`: Re-triggers owner notification for a specific call (rate limited to 1 per 30s per call).
  - `GET /api/events`: Server-Sent Events (SSE) stream for real-time dashboard updates.
  - `GET /api/health`: Healthcheck endpoint returning `{ ok: true }`.
- **WebSocket Upgrade (`/ws`)**:
  - Attached to the HTTP server for `/ws` connections.
  - Incoming client messages:
    - `{ type: "join", missedCallId: string }`
    - `{ type: "transcript", final: true, text: string }`
    - `{ type: "barge_in" }`
    - `{ type: "end", reason?: string }`
  - Outgoing server messages:
    - `{ type: "state", state: string }`
    - `{ type: "agent_text", text: string }`
    - `{ type: "stop_audio" }`
    - `{ type: "metrics", totalMs, llmFirstTokenMs, ttsFirstAudioMs, timeToFirstAudio }`
    - `{ type: "summary", summary: object }`
    - `{ type: "error", message: string }`
    - Binary frames: raw 24 kHz linear PCM chunks (`Uint8Array`).

### 3.2. Session State Machine & Orchestrator ([`server/session.ts`](file:///c:/projects/Missed-Call-Rescuer/server/session.ts))
- **State Machine**:
  - States: `GREETING`, `SPEAKING`, `LISTENING`, `THINKING`, `ENDING`, `SUMMARIZING`, `DONE`.
  - Start: `GREETING` -> `SPEAKING` (speaks greeting) -> `LISTENING`.
  - Turn execution: `LISTENING` -> `THINKING` (LLM streaming) -> `SPEAKING` (first audio chunk arrives) -> `LISTENING` (turn finished).
  - Barge-in: `SPEAKING` or `THINKING` -> `LISTENING` (generation canceled, audio halted).
  - Termination: `ENDING` -> `SUMMARIZING` -> `DONE`.
- **Timers**:
  - Hard session timeout: 5 minutes (`session.maxTimer = setTimeout(() => endSession(session, 'timeout'), 5 * 60 * 1000)`).
  - TTS keep-alive: 30 seconds (`session.keepAliveTimer = setInterval(..., 30000)`).
- **Concurrency & Pacing**:
  - Drops incoming utterances while `generating = true` to prevent overlapping responses.
- **Persistence Deferral**:
  - Customer turn inserts into `turns` are deferred to the next event-loop turn using `setImmediate` (`deferDb = true`) to avoid blocking LLM initiation.

### 3.3. AssemblyAI Streaming TTS Client ([`server/tts.ts`](file:///c:/projects/Missed-Call-Rescuer/server/tts.ts))
- Endpoint: `wss://tts.us.assemblyai.com/v1/ws`.
- Voice: `aai-jane` (or `ASSEMBLYAI_VOICE_ID`), 24 kHz sample rate, 16-bit linear PCM (`pcm_s16le`), English.
- **Authentication**: Sent in WebSocket connection headers using the `Authorization` header with the raw API key value (`Authorization: <api-key>`), without a `Bearer ` prefix.
- **Protocol**:
  - Sends `{ type: "Generate", text }` followed by `{ type: "Flush" }`.
  - Receives base64-encoded `Audio` frames and converts them to binary buffers.
  - Sends `{ type: "Cancel" }` on barge-in to stop synthesis and drop queued frames.
  - Sends periodic `{ type: "KeepAlive" }` frames.
  - Includes single-attempt reconnection logic on connection loss.

### 3.4. LLM Integration & Summarization ([`server/llm.ts`](file:///c:/projects/Missed-Call-Rescuer/server/llm.ts))
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

### 3.5. Persistence Layer ([`server/db.ts`](file:///c:/projects/Missed-Call-Rescuer/server/db.ts))
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

The primary latency metric is strictly defined as the **time from end of recognized speech to first audio byte**.

Browser speech recognition (`webkitSpeechRecognition` in Chrome or Edge) enforces an internal silence window of approximately 0.8 to 1.2 seconds before marking speech final, which precedes the measured timer.

### Measured Turn Latency Stages (Average)

```
0 ms ── Speech recognition turn end
  │
  ├─ 0 to 305 ms (305 ms) : LLM streams first clause / 6 words
  │
  ├─ 305 to 331 ms (26 ms): Early chunk boundary extraction & TTS WebSocket dispatch
  │
  └─ 331 to 693 ms (362 ms): AssemblyAI TTS first audio chunk delivered
                               │
                             693 ms total (time from end of recognized speech to first audio byte)
```

- **Early Chunking ([`extractNextChunk`](file:///c:/projects/Missed-Call-Rescuer/server/session.ts#L31-L74))**: First chunk is dispatched to TTS when punctuation (`,`, `;`, `:`, `—`, `--`, `.`, `!`, `?`) occurs OR at least 6 words (`FIRST_CHUNK_MIN_WORDS`) are collected. Subsequent chunks split on sentence punctuation (`.`, `!`, `?`).
- **Deferred Persistence**: SQLite writes for customer turns are deferred to the next event-loop turn (`setImmediate`) to keep database I/O off the critical turn path.

---

## 5. Barge-In & Safety Handling

### 5.1. Barge-In Guard: Self-Speech Filter
The customer call interface ([`src/app/call/[token]/page.tsx`](file:///c:/projects/Missed-Call-Rescuer/src/app/call/%5Btoken%5D/page.tsx#L83-L94)) includes guards to prevent false barge-in triggers during `SPEAKING` and `THINKING` states:
1. **Word Threshold**: At least 2 words in the interim transcript.
2. **Time Guard**: At least 400 ms since agent speech began.
3. **Self-Speech Filter**: Jaccard word-overlap similarity check between the interim transcript and the agent's current spoken text. If similarity exceeds 0.6, the utterance is treated as feedback and ignored. It is a text-overlap filter on recognized transcript words, not acoustic echo cancellation.
4. **Cancellation**: If barge-in triggers, client sends `{ type: "barge_in" }`, stops local Web Audio playback, and the server aborts the LLM request, cancels TTS synthesis, and marks the turn as `interrupted = 1`.

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
- Displays call list with latency metrics in milliseconds (Total time, LLM TTFT, and TTS TTFA) and structured summary cards.

### 6.2. Customer Call Page ([`src/app/call/[token]/page.tsx`](file:///c:/projects/Missed-Call-Rescuer/src/app/call/%5Btoken%5D/page.tsx))
- Web Speech API (`webkitSpeechRecognition`) for speech-to-text.
- Web Audio API `AudioContext` scheduled at 24 kHz for sequential linear PCM playback.
- Displays live dialogue transcript, real-time latency indicators, and call summaries upon completion.
