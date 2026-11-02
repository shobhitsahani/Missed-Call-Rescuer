# Missed-Call Rescuer

Missed-Call Rescuer turns a logged missed call into a voice callback session (in the browser), finds out what the customer wanted, and gives the owner a structured summary.

**Live Application**: [https://missed-call-rescuer.vercel.app](https://missed-call-rescuer.vercel.app)  
**Source Code Repository**: [https://github.com/shobhitsahani/Missed-Call-Rescuer](https://github.com/shobhitsahani/Missed-Call-Rescuer)  
**Backend API / Health Check**: [https://missed-call-rescuer-api.onrender.com/api/health](https://missed-call-rescuer-api.onrender.com/api/health)

---

### Dashboard Interface
![Owner Dashboard](public/dashboard.png)

### Customer Call Interface
![Customer Call Interface](public/call-interface.png)

---

## How Judges Can Try It

1. **Open the live dashboard**: Navigate to [https://missed-call-rescuer.vercel.app](https://missed-call-rescuer.vercel.app). The live dashboard opens directly without requiring an access code (open hackathon demo mode).
2. **Simulate a missed call**: Click the **"Simulate missed call"** button in the header to generate a sample inbound missed call.
3. **Open the callback link**: Click the generated link (`/call/<token>`) to launch the browser voice callback session. Each link uses a secure 128-bit unguessable token valid for 30 minutes.
4. **Grant microphone access**: Use Google Chrome (the app was tested in Chrome; other browsers are untested). Put on headphones to prevent speaker audio from echoing back into the microphone.
5. **Converse naturally**: Listen to the automated greeting (which explicitly identifies itself as an automated assistant), then describe your issue (e.g., *"Hi, I have a leaking pipe under my kitchen sink"*).
6. **Test barge-in & safety**:
   - **Barge-in**: Interrupt the assistant mid-sentence; verify instant audio cutoff.
   - **Opt-out**: Say *"Please stop calling me and remove my number"* to verify immediate polite termination and `opted_out` status update.
7. **Inspect the dashboard**: Return to the dashboard to review:
   - Real-time call logs and status badges updated via Server-Sent Events.
   - Honest metrics ("Completed / missed calls" and latency averages based on recorded calls).
   - Call details drawer with turn-by-turn playback, structured callback time, and one-click TXT/JSON transcript exports.
   - Settings page with business presets, tone configuration, and live audio previews for 10+ AssemblyAI neural voices.

---

## Features

- **In-Browser Voice Callback Session**: Low-latency duplex voice session over WebSockets with 16 kHz PCM microphone capture via AudioWorklet and 24 kHz gapless playback via Web Audio API.
- **AssemblyAI Streaming STT & TTS**: High-speed real-time speech recognition using `universal-3-6-pro` and expressive neural speech synthesis via `assemblyai-tts-1`.
- **Server-Side Barge-In Interruption Detection**: Real-time interruption guard evaluating interim word counts and timing with a self-speech similarity filter to prevent echo loops.
- **Strict Structured Summaries**: Automatic post-call extraction validating urgency (`low`, `medium`, `high`), sentiment (`positive`, `neutral`, `negative`), caller intent, contact info, and suggested actions, with automated 1-retry fallback to unavailable state.
- **Real-Time Owner Dashboard**: Instant updates via Server-Sent Events (SSE). Public SSE payloads carry only a call id and a masked phone number — never callback tokens or full customer numbers. Includes honest completion metrics and latency measurement cards.
- **Searchable Call History & TanStack Table**: Sortable, filterable, paginated call logs with detailed turn inspection.
- **Call Drawer & Audio Transcript Playback**: Dialogue turns display speaker roles, interruption indicators, and timestamps.
- **One-Click Transcript Exports**: Download call records and full conversational transcripts in formatted TXT or structured JSON.
- **Voice Selection & Live Audio Preview**: Test and preview 10+ AssemblyAI neural voices directly in the Settings tab with in-memory audio caching.
- **Multi-Provider Owner Notifications**: Fire-and-forget plain-text dispatch to Telegram bots or Discord channels upon call completion with test and manual resend actions.
- **Theme Customization**: Responsive dark, light, and system themes.

---

## Prerequisites

- **Tested Browser**: Google Chrome. Other browsers (Firefox, Safari, Edge) are untested and may exhibit audio worklet or speech recognition differences.
- **Hardware**: Working microphone. Headphones are strongly recommended to prevent microphone feedback from speaker audio triggering accidental barge-in.
- **Runtime** (for local development): Node.js 20 or higher, npm.

---

## Local Development & Verification

```bash
npm install --include=dev       # install (tsx is a dev dependency)
npm run dev                     # backend on http://localhost:4000 + frontend on http://localhost:3010
npm test                        # unit + settings-validation tests (settings tests need a live backend on :4000)
npm run test:security           # 15 security regression checks (origins, tokens, SSE privacy, budgets, admin gating)
npm run typecheck               # TypeScript, no emit
npm run lint                    # ESLint
npm run build                   # production build (frontend + backend)
```

Live-provider verification scripts (require real `ASSEMBLYAI_API_KEY` / `OPENAI_API_KEY` in `.env`; they make real provider calls):

```bash
npx tsx scripts/verify-live-voice-workflow.ts   # scripted browser voice calls: greeting, phone collection, refusal, barge-in
npx tsx scripts/verify-settings-voice.ts        # settings save/reload + AAI voice preview audio
npx tsx scripts/verify-ui-call.ts               # headless Chrome full call E2E
npx tsx scripts/capture-screenshots.ts          # dashboard screenshots for documentation
```

> [!NOTE]
> `npm test` includes the settings-validation suite which calls the HTTP API on `http://localhost:4000` — start `npm run dev` first, or set `API_BASE` to a running backend.

---

## Deployment

Missed-Call Rescuer is split into a frontend web dashboard (Vercel) and a real-time Express WebSocket backend (Render).

```
[ Frontend: Vercel ]  ────────── HTTPS / WSS ──────────> [ Backend: Render ]
(Next.js App Router)                                    (Express + WebSockets + SQLite)
```

### 1. Frontend on Vercel
- **Root Directory**: `.` (repository root)
- **Framework Preset**: Next.js
- **Build Command**: `next build`
- **Output Directory**: `.next`
- **Environment Variables**:
  - `NEXT_PUBLIC_API_BASE`: Public HTTPS URL of the backend (e.g. `https://missed-call-rescuer-api.onrender.com`).

### 2. Backend on Render (`render.yaml`)
- **Service Type**: Web Service (Node).
- **Build Command**: `npm install --include=dev` (`tsx` is a dev dependency used by the start command).
- **Start Command**: `npx tsx server/index.ts`
- **Persistent Storage (optional, paid plan)**: On the Render free tier the filesystem is ephemeral — SQLite data survives in-place restarts but is **lost on every redeploy or instance replacement**. To retain call history permanently, attach a Render persistent disk (paid tier) with mount path `/var/data` and set `DB_PATH=/var/data/app.db`. The included `render.yaml` targets the free tier and does not attach a disk.
- **Free Tier Cold-Starts**: Render free instances spin down after 15 minutes of inactivity. The initial wake-up request can take ~50 seconds before the health endpoint returns 200 OK.

### Complete Environment Variables Reference

| Variable | Description | Example / Default | Location | Secret? |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_BASE` | Public URL of backend server | `https://missed-call-rescuer-api.onrender.com` | Vercel & Backend | No |
| `PORT` | Backend HTTP & WebSocket port | `4000` | Backend | No |
| `NODE_ENV` | Runtime environment mode | `production` | Backend & Vercel | No |
| `ALLOWED_ORIGINS` | Permitted CORS & WebSocket origins (comma-separated) | `https://missed-call-rescuer.vercel.app` | Backend | No |
| `ASSEMBLYAI_API_KEY` | AssemblyAI API key for Streaming STT & TTS | `aai_xxxxxxxxxxxxxx` | Backend | **Yes** |
| `ASSEMBLYAI_VOICE_ID` | Default voice synthesis model ID | `aai-jane` | Backend | No |
| `STT_PROVIDER` | Speech-to-text engine (`assemblyai` or `browser`) | `assemblyai` | Backend | No |
| `OPENAI_API_KEY` | LLM API key (Groq, OpenAI, or OpenRouter) | `gsk_xxxxxxxxxxxxxx` | Backend | **Yes** |
| `OPENAI_BASE_URL` | Base URL for OpenAI-compatible endpoint | `https://api.groq.com/openai/v1` | Backend | No |
| `OPENAI_MODEL` | LLM model identifier | `qwen/qwen3.8-27b` | Backend | No |
| `DB_PATH` | Path to persistent SQLite database file | `/var/data/app.db` | Backend | No |
| `MAX_CONCURRENT_CALLS`| Maximum simultaneous active calls | `2` | Backend | No |
| `MAX_CALLS_PER_DAY` | Daily budget cap for voice calls | `100` | Backend | No |
| `MAX_CALL_SECONDS` | Maximum allowed duration per call in seconds | `300` | Backend | No |
| `ADMIN_TOKEN` | When set in production, required as `x-admin-token` for admin/test routes. Leave empty to disable those routes. | _(empty)_ | Backend | **Yes** |
| `GROQ_API_KEY` | Optional Groq key; takes precedence over `OPENAI_API_KEY` when set | `gsk_xxxxxxxxxxxxxx` | Backend | **Yes** |
| `ASSEMBLYAI_SPEECH_MODEL` | AssemblyAI streaming STT model | `universal-3-6-pro` | Backend | No |
| `NOTIFY_PROVIDER` | Owner alert provider (`telegram`, `discord`, `none`) | `none` | Backend | No |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | `123456789:ABCdef...` | Backend | **Yes** |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for owner alerts | `123456789` | Backend | **Yes** |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL for owner alerts | `https://discord.com/api/webhooks/...` | Backend | **Yes** |

### Post-Deployment Checklist

- [ ] Backend `/api/health` returns `{"ok":true}`.
- [ ] Vercel frontend loads without 404s.
- [ ] Dashboard loads immediately with full overview metrics and tables.
- [ ] Simulate missed call produces a callback link with a 128-bit hex token.
- [ ] Customer call page connects over WebSocket (`/ws`) and streams microphone audio.
- [ ] Barge-in interrupts agent speech when speaking mid-sentence.
- [ ] Call completion persists dialogue turns, structured summary, and notifies configured channel.
- [ ] (Optional, paid disk only) Persistent disk retains records across server restart — free tier keeps data until the next redeploy.

---

## Owner Notifications

When a callback session finishes and a structured summary is extracted, the backend dispatches an instant plain-text alert to the business owner via Telegram or Discord.

> [!IMPORTANT]
> **Host Configuration**: Notification variables (`NOTIFY_PROVIDER`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`) must be set on the **backend host (Render)**, not on Vercel. Notifications are dispatched entirely by the Express backend worker.

### Telegram Setup
1. Message `@BotFather` on Telegram to create a bot and copy the token (`TELEGRAM_BOT_TOKEN`).
2. Start your bot, send a message to it, and fetch your numeric Chat ID from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. Set `NOTIFY_PROVIDER=telegram`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID` on Render.

### Discord Setup
1. In Discord channel settings, create a Webhook and copy its URL (`DISCORD_WEBHOOK_URL`).
2. Set `NOTIFY_PROVIDER=discord` and `DISCORD_WEBHOOK_URL` on Render.

---

## Latency & Turnaround Time

Latency measured across 3 automated verification runs (15 total conversational turns) using streaming PCM audio against upstream AssemblyAI and Groq cloud APIs ([scripts/verify-pipeline.ts](scripts/verify-pipeline.ts)):

| Latency Component | Measured Average | Range | Description |
|---|---|---|---|
| **Turn Detection** (`turnDetectionMs`) | **289 ms** | 254–336 ms | Time from end of caller utterance to AssemblyAI `end_of_turn: true` |
| **LLM First Token** (`llmFirstTokenMs`) | **1,356 ms** | 1,239–1,506 ms | Time from `end_of_turn` to first token streamed from Groq |
| **TTS First Audio** (`ttsFirstAudioMs`) | **365 ms** | 340–439 ms | Time from `Generate` command to first audio chunk from AssemblyAI TTS |
| **Total Processing Pipeline** (`totalMs`) | **1,747 ms** | 1,627–1,906 ms | Total elapsed time from `end_of_turn` to first playable audio byte |

> [!NOTE]
> **Measurement Environment**: Measured on a local test client communicating over broadband Internet to upstream AssemblyAI and Groq endpoints.
>
> The **Dashboard Latency Card** displays cumulative rolling averages across all calls stored in the database, including earlier tests and manual runs.

---

## Privacy & Data Handling Notice (Demo)

> [!IMPORTANT]
> **Use Synthetic Test Data Only**:
> - **Do NOT enter real personal phone numbers** or confidential customer records during the live public demonstration. Always use synthetic numbers (e.g. `+1 (555) 010-XXXX` or Indian standard dummy ranges).
> - **What is Stored**: The demonstration logs simulated call timestamps, caller identifiers, audio turn transcripts, and AI-extracted summaries in SQLite (`data/app.db`).
> - **Privacy Protections**: Public Server-Sent Events (SSE) and dashboard list APIs mask phone numbers (`+1 ******9999`) and omit callback tokens from broadcast payloads.
> - **Clearing Test Data**: Evaluators can purge test and demo records via the dashboard ("Demo options" -> "Clear test data") or via `POST /api/admin/clear-test-data` (gated by `ADMIN_TOKEN` when set in production).
> - **Production Note**: Open demo mode is designed specifically for frictionless judge evaluation. Masking alone does not constitute HIPAA or GDPR compliance; real production deployments require tenant isolation and strict customer access control.

---

## Known Limitations

- **Browser-Only Voice Sessions**: Calls run inside the browser via Web Audio and WebSockets. There is no real PSTN carrier integration or SIP trunking to ring physical mobile phones.
- **Callback Job Processing**: `callback_jobs` rows are created and logged in SQLite, but are not dispatched by an automated dialer daemon.
- **In-Memory Session State**: Active voice session state is held in-memory on the active Node.js server. Horizontal scaling requires sticky sessions or an external Redis state store.
- **Single Business Seed**: The database seeds a single business profile (`Acme Plumbing`). Multi-business tenancy is not currently merged.
- **Free-Tier Rate Limits**: Free tier AssemblyAI and Groq credentials have concurrency limits (default `MAX_CONCURRENT_CALLS=2`).
- **Open Demo Mode**: The hackathon demo runs in frictionless open access mode without user logins. Rate limits, daily budget caps, unguessable call tokens, and CORS origin restrictions protect backend resources. Public dashboard APIs still return missed-call callback tokens (so judges can open a call) and masked phone numbers. Do not treat this as a multi-tenant production lock-down.
- **Render Free-Tier Cold Start**: The backend on the Render free plan can sleep after idle time. The first dashboard or call request after sleep may take 30–60 seconds. Retry if the dashboard shows a backend connection error.
- **Hackathon demo video**: The AssemblyAI Voice Hackathon submission form requires a demo video link. The live site is not a substitute unless organizers approve an exception. Record and upload the video separately using the shot list in [`docs/SUBMISSION.md`](docs/SUBMISSION.md).

---

## License & Credits

- **License**: MIT License (see [LICENSE](LICENSE)).
- **Speech Recognition**: Powered by AssemblyAI Streaming STT (`universal-3-6-pro`).
- **Speech Synthesis**: Powered by AssemblyAI Streaming TTS (`assemblyai-tts-1`).
