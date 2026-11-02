# Hackathon Submission Pack — Missed-Call Rescuer

**Project Name**: Missed-Call Rescuer  
**Live Frontend URL**: [https://missed-call-rescuer.vercel.app](https://missed-call-rescuer.vercel.app)  
**Backend API / Health**: [https://missed-call-rescuer-api.onrender.com/api/health](https://missed-call-rescuer-api.onrender.com/api/health)  
**Repository**: [https://github.com/shobhitsahani/Missed-Call-Rescuer](https://github.com/shobhitsahani/Missed-Call-Rescuer)  
**Demo Video**: [Watch 90-second Demo Video](TODO_ADD_VIDEO_URL) *(Paste video URL prior to submission)*  

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

1. **Access the Dashboard**: Navigate to [https://missed-call-rescuer.vercel.app](https://missed-call-rescuer.vercel.app). If an access code is active, enter your designated judge access code; in open demo mode, the dashboard opens directly.
2. **Simulate an Inbound Missed Call**: Click **"Simulate missed call"** in the top navigation bar. A new missed call is logged and an unguessable 128-bit callback link is generated.
3. **Launch the Callback Voice Session**: Click the generated callback link (`/call/<token>`) to open the customer voice interface in Google Chrome. Put on headphones to prevent speaker audio from bleeding into the microphone.
4. **Grant Microphone Access & Greet**: Click **"Start call"** (or allow browser microphone permissions). Listen as the assistant introduces itself, explicitly disclosing that it is an automated assistant calling on behalf of Acme Plumbing.
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

## 4. 90-Second Demo Video Script

**Target Duration**: 90 seconds (1 minute 30 seconds)  
**Tone**: Confident, fast-paced, clear, practical.  
**Preparation**: Have Chrome open with two windows side-by-side (Left: Owner Dashboard; Right: Callback link `/call/<token>`). Wear headphones.

| Timestamp | Visual / Screen Action | Spoken Narration |
|---|---|---|
| **0:00 – 0:15** | Show owner dashboard with stat cards and call table. Click "Simulate missed call". | *"Small service businesses lose high-value jobs every day to missed calls. When a customer calls a plumber or contractor and gets voicemail, they just call the next business. Missed-Call Rescuer solves this by turning missed calls into instant voice callback sessions in the browser."* |
| **0:15 – 0:35** | Click the generated call link. Assistant greets with disclosure. Speak: *"Hi, my water heater is leaking water everywhere across the basement floor."* | *"Here, a customer opens their callback link. The assistant greets them, clearly disclosing that it's automated. Powered by AssemblyAI's streaming STT and TTS, voice latency feels completely natural."* |
| **0:35 – 0:50** | Agent begins replying. Speak mid-sentence: *"Actually, wait! Can you send an emergency technician tonight?"* Assistant immediately silences and responds to the new question. | *"Notice the real-time barge-in. When I interrupt mid-sentence, our server-side speech guard instantly kills audio playback and redirects the conversation without awkward overlaps or echo loops."* |
| **0:50 – 1:05** | Say: *"Thanks, my number is 555-0199 and my name is Alex. Goodbye!"* Call completes. | *"The assistant records the caller's emergency, contact details, and callback preference, then wraps up the call cleanly."* |
| **1:05 – 1:20** | Switch back to the dashboard window. Show the new call popping up live via SSE. Click to open Drawer with structured summary and dialogue turns. | *"Instantly, the owner dashboard receives the completed call via Server-Sent Events. We see an honest summary: emergency urgency, caller details, suggested action, and millisecond latency measurements. An alert is also fired to Telegram or Discord."* |
| **1:20 – 1:30** | Click Settings tab, click play on a voice preview ("aai-jane" or "aai-drew"), show dark/light theme toggle. | *"Owners can customize operating hours, services, and select from over ten AssemblyAI neural voices. Missed-Call Rescuer: turning missed calls into booked revenue."* |

### Fallback Plan (Speech / Audio Hiccups)
- If microphone permissions fail or network lag delays STT in your recording environment, use the browser fallback mode or re-record the 15-second conversational turn using the prepared audio clips in `scripts/verify-pipeline.ts`.
- Keep the script visual: even with muted audio, the live interim transcript and drawer summary clearly prove end-to-end functionality.

---

## 5. Pre-Submission Checklist

- [x] Backend deployed on Render and `/api/health` returns `{"ok":true}`.
- [x] Frontend deployed on Vercel (`https://missed-call-rescuer.vercel.app`).
- [x] Security verified: Unguessable 128-bit call tokens, 30-minute expiry, single-use, CORS & WebSocket origin check.
- [x] Automated security test suite (`scripts/test-security.ts`) passes 14/14 tests.
- [x] Pipeline verification benchmark (`scripts/verify-pipeline.ts`) passes 3 consecutive runs.
- [x] Honest metrics implemented: "Completed / missed calls", hidden when < 5 calls, latency averages state sample size.
- [x] No untrue marketing claims ("autonomous", "appointment booking", "calls customers").
- [x] Zero TypeScript errors (`npx tsc --noEmit`).
- [x] Zero ESLint errors (`npm run lint`).
- [x] Production build passes (`npm run build`).
- [x] No `.env`, secrets, API keys, or `data/*.db` committed to git.
- [ ] Record 90-second demo video and paste link into `README.md` and `docs/SUBMISSION.md`.
- [ ] Submit project link and judge access code in the official hackathon submission portal.
