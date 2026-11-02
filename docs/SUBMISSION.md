# Hackathon Submission Pack — Missed-Call Rescuer

**Project Name**: Missed-Call Rescuer  
**Primary Evaluation (Live Website)**: [https://missed-call-rescuer.vercel.app](https://missed-call-rescuer.vercel.app)  
**Source Code Repository**: [https://github.com/shobhitsahani/Missed-Call-Rescuer](https://github.com/shobhitsahani/Missed-Call-Rescuer)  
**Backend API / Health**: [https://missed-call-rescuer-api.onrender.com/api/health](https://missed-call-rescuer-api.onrender.com/api/health)  

> [!TIP]
> **Live Evaluation**: Missed-Call Rescuer is fully deployed and interactive. Judges can evaluate the live voice pipeline, real-time barge-in, structured summaries, and owner dashboard directly through the deployed website in Google Chrome without configuration or authentication friction.

---

## 1. Short Description (~80 words)

Small service businesses lose valuable revenue every time an incoming call goes unanswered. Missed-Call Rescuer rescues lost opportunities by converting missed calls into instant, interactive browser voice callback sessions. Powered by AssemblyAI's Streaming Speech-to-Text (`universal-3-6-pro`) and Streaming Text-to-Speech (`assemblyai-tts-1`), the AI assistant discloses its identity, speaks naturally with low-latency turn detection, supports real-time barge-in, and extracts structured summaries (reason, urgency, preferred callback time, sentiment) straight to the owner's dashboard and mobile notifications.

---

## 2. Detailed Description (~250 words)

When small service businesses like plumbers, electricians, or auto repair shops miss an inbound call, potential customers immediately call the next competitor. Traditional voicemails have dismal completion rates because customers dislike leaving recorded messages and owners rarely check them in time.

Missed-Call Rescuer bridges this gap with an automated voice callback session conducted directly in the browser. When a missed call occurs, the system logs the event and produces a secure, unguessable 128-bit callback link. Opening the link launches a low-latency duplex voice session powered by AssemblyAI's streaming audio infrastructure.

The browser captures microphone input via an `AudioWorklet`, downsamples it to 16 kHz mono linear PCM, and streams chunks over a WebSocket to an Express backend. AssemblyAI's `universal-3-6-pro` streaming model transcribes audio in real time with endpointing silence detection (~289 ms turn detection). The agent evaluates server-side barge-in using interim word counts and a self-speech similarity filter to instantly stop audio when the caller interrupts. Responses from an OpenAI-compatible LLM stream through an early clause chunking buffer directly into AssemblyAI's persistent WebSocket TTS (`assemblyai-tts-1`), achieving ~1.75s conversational turnaround.

When the conversation finishes, the backend strictly validates a structured JSON summary capturing caller reason, urgency, preferred time, sentiment, and recommended action. The result appears in real time on the Next.js owner dashboard via Server-Sent Events and triggers instant mobile alerts via Telegram or Discord, ensuring business owners capture every lead without being tied to a phone.

---

## 3. Step-by-Step Judge Testing Path (7 Steps)

1. **Access the Dashboard**: Navigate to [https://missed-call-rescuer.vercel.app](https://missed-call-rescuer.vercel.app). In open demo mode, the dashboard opens immediately with zero password friction.
2. **Simulate an Inbound Missed Call**: Click **"Simulate missed call"** in the top navigation bar. A new missed call is logged and an unguessable 128-bit callback link is generated.
3. **Launch the Callback Voice Session**: Click the generated callback link (`/call/<token>`) to open the customer voice interface in Google Chrome. Put on headphones to prevent speaker audio from bleeding into the microphone.
4. **Grant Microphone Access & Greet**: Click **"Start call"** (allow browser microphone permissions). Listen as the assistant introduces itself, explicitly disclosing that it is an automated assistant calling on behalf of Acme Plumbing.
5. **Test Natural Conversation & Barge-In**:
   - Describe a service request: *"Hi, I have water leaking under my kitchen sink and need someone tomorrow morning."*
   - Test barge-in: Interrupt the assistant while it speaks; verify that audio cuts off instantly and the assistant listens to your new input.
6. **Test Opt-Out & Safety**:
   - Say: *"Please stop calling me and remove my number."*
   - Verify the assistant politely confirms, terminates the call immediately, and marks the status as `opted_out`.
7. **Inspect Real-Time Records & Settings**:
   - Return to the owner dashboard to view the completed call, honest completion rate, latency breakdown cards, and full turn-by-turn dialogue drawer with TXT/JSON export.
   - Open the **Settings** view to test business preset profiles (e.g. Acme Plumbing, Dental Clinic) and preview 10+ AssemblyAI neural voices.

---

## 4. Key Interactive Capabilities to Test Live

Judges can evaluate every core capability directly on the live website:

| Capability | Live Testing Action | Verification Outcome |
|---|---|---|
| **Missed Call Simulation** | Click **"Simulate missed call"** on dashboard | Logs missed call with 128-bit hex token link |
| **Streaming Voice Greeting** | Open `/call/<token>`, click **"Start call"** in Google Chrome | Assistant speaks automated disclosure greeting via AssemblyAI TTS (`assemblyai-tts-1`) |
| **Real-Time Speech-to-Text** | Speak naturally: *"My basement pipe burst and I need help immediately"* | Real-time interim and final transcripts appear live via AssemblyAI STT (`universal-3-6-pro`) |
| **Server-Side Barge-In** | Speak mid-sentence while agent is speaking: *"Wait, how much will it cost?"* | Agent audio stops instantly; prior completion is aborted and new question is addressed |
| **Opt-Out Safety Guard** | Say: *"Please stop calling me and remove my number"* | Agent politely terminates; missed call is marked `opted_out` in database |
| **Structured JSON Summarization** | Conclude call naturally; check dashboard | Structured reason, urgency, callback time, and sentiment update live via SSE |
| **Owner Notifications** | Click "Demo options" -> "Send test notification" | Dispatches instant summary alert to Telegram bot or Discord channel |
| **Neural Voice Previews** | Open **Settings** view, click Play on voice cards | Low-latency streaming preview audio of 10+ AssemblyAI neural voices |
| **Transcript Exports** | Open call details drawer in dashboard | One-click export of complete turn-by-turn conversation as `.txt` or `.json` |

---

## 5. Pre-Submission Checklist

- [x] Redeploy verified `fix/final-hardening` backend to Render and frontend to Vercel (Merged into `main` and live at `https://missed-call-rescuer-api.onrender.com` & `https://missed-call-rescuer.vercel.app`).
- [x] Security verified in automated tests: unguessable 128-bit call tokens, 30-minute expiry, single-use, CORS & WebSocket origin check, SSE phone masking.
- [x] Automated security test suite (`scripts/test-security.ts`) covers open access, CORS, WebSocket origin, tokens, SSE privacy, budgets, rate limits, and admin gating.
- [x] Honest metrics implemented: "Completed / missed calls", hidden when < 5 calls, latency averages state sample size.
- [x] No untrue marketing claims ("autonomous", "appointment booking", "calls customers").
- [x] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:security`, `npm run test:reconnect`, `npm run check:secrets`, and `npm run build` all pass 100%.
- [x] No `.env`, secrets, API keys, or `data/*.db` committed to git.
- [ ] Record and upload the required hackathon demo video (live website is not a confirmed substitute).
- [ ] Submit project URL (`https://missed-call-rescuer.vercel.app`) and GitHub repository link (`https://github.com/shobhitsahani/Missed-Call-Rescuer`) in the official hackathon submission portal.

---

## 6. Demo Video Shot List (you record this)

The AssemblyAI Voice Hackathon form requires a demo video. Do not skip this unless an organizer-approved exception exists.

Suggested 60–90 second sequence:

1. Open the dashboard (no access code). Point out live metrics and missed-call list.
2. Open Settings and preview two voices.
3. Click **Simulate missed call**, then open the tokenized `/call/<token>` link.
4. Start the call, hear the greeting, speak a request, and give a callback number.
5. End the call and show the dashboard updating with the new record.
6. Optionally mention Telegram/Discord if those are configured.
