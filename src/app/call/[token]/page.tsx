'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { API_BASE, api } from '@/lib/api';
import { SummaryCard } from '@/components/SummaryCard';
import { TranscriptBubble } from '@/components/TranscriptBubble';
import { AgentStatusVisualizer } from '@/components/AgentStatusVisualizer';

type TurnMetric = {
  totalMs: number;
  llmFirstTokenMs: number | null;
  ttsFirstAudioMs: number | null;
};

type TranscriptItem = {
  role: string;
  text: string;
  interrupted?: boolean;
};

export default function CallPage() {
  const params = useParams();
  const token = params?.token as string;
  const [business, setBusiness] = useState<any>(null);
  const [status, setStatus] = useState('idle');
  const [started, setStarted] = useState(false);
  const [state, setState] = useState('GREETING');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [latestMetric, setLatestMetric] = useState<TurnMetric | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<TurnMetric[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<any>(null);
  const endedRef = useRef(false);
  const stateRef = useRef(state);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Load business details for caller banner
  useEffect(() => {
    api('/api/business')
      .then(b => setBusiness(b))
      .catch(() => {});
  }, []);

  // Auto-scroll transcript container to latest message
  useEffect(() => {
    if (transcriptBottomRef.current) {
      transcriptBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);

  // Web Audio scheduling
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // Barge-in guards
  const agentSpeakingStartRef = useRef<number>(0);
  const currentAgentTextRef = useRef<string>('');
  useEffect(() => {
    if (state === 'SPEAKING') agentSpeakingStartRef.current = Date.now();
  }, [state]);

  function initAudio() {
    if (!audioCtxRef.current) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx({ sampleRate: 24000 });
    }
    const ctx = audioCtxRef.current!;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return audioCtxRef.current!;
  }

  function playPcmChunk(arrayBuffer: ArrayBuffer) {
    const ctx = initAudio();
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const buf = ctx.createBuffer(1, float32.length, 24000);
    buf.copyToChannel(float32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    if (nextStartRef.current < now) nextStartRef.current = now;
    src.start(nextStartRef.current);
    nextStartRef.current += buf.duration;
    sourcesRef.current.push(src);
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter(s => s !== src);
    };
  }

  const markLastAgentTurnInterrupted = useCallback(() => {
    setTranscript(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'agent') {
          copy[i] = { ...copy[i], interrupted: true };
          break;
        }
      }
      return copy;
    });
  }, []);

  function stopAllAudio() {
    for (const s of sourcesRef.current) {
      try {
        s.stop();
      } catch {}
    }
    sourcesRef.current = [];
    if (audioCtxRef.current) nextStartRef.current = audioCtxRef.current.currentTime;
  }

  function similar(a: string, b: string) {
    const na = a.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const nb = b.toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (!na || !nb) return false;
    if (nb.includes(na) || na.includes(nb)) return true;
    const wa = new Set(na.split(/\s+/));
    const wb = new Set(nb.split(/\s+/));
    let overlap = 0;
    for (const w of wa) if (wb.has(w)) overlap++;
    const ratio = overlap / Math.max(wa.size, wb.size, 1);
    return ratio > 0.6;
  }

  function connect() {
    if (started) return;
    setStarted(true);
    setStatus('connecting');
    setError(null);
    initAudio();

    const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'join', missedCallId: token }));
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        playPcmChunk(ev.data);
        return;
      }
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'state':
          setState(msg.state);
          break;
        case 'agent_text':
          currentAgentTextRef.current = msg.text;
          setTranscript(t => [...t, { role: 'agent', text: msg.text }]);
          break;
        case 'stop_audio':
          stopAllAudio();
          markLastAgentTurnInterrupted();
          break;
        case 'metrics': {
          const total = typeof msg.totalMs === 'number' ? msg.totalMs : msg.timeToFirstAudio;
          const llm = typeof msg.llmFirstTokenMs === 'number' ? msg.llmFirstTokenMs : null;
          const tts = typeof msg.ttsFirstAudioMs === 'number' ? msg.ttsFirstAudioMs : null;
          if (typeof total === 'number') {
            const m: TurnMetric = { totalMs: total, llmFirstTokenMs: llm, ttsFirstAudioMs: tts };
            setLatestMetric(m);
            setMetricsHistory(prev => [...prev, m]);
          }
          break;
        }
        case 'summary':
          setSummary(msg.summary);
          break;
        case 'error':
          setError(msg.message || 'An unexpected error occurred during the call.');
          break;
      }
    };

    ws.onclose = () => {
      setStatus('closed');
    };

    ws.onerror = () => {
      setError('Connection lost. Could not communicate with the voice server.');
    };

    // Speech-to-text setup
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition is not supported in this browser. Use Chrome or Edge.');
      return;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e: any) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }

      // Barge-in guard evaluation
      if (interim && (stateRef.current === 'SPEAKING' || stateRef.current === 'THINKING')) {
        const words = interim.trim().split(/\s+/).filter(Boolean).length;
        const speakingFor = Date.now() - agentSpeakingStartRef.current;
        if (words >= 2 && speakingFor >= 400 && !similar(interim, currentAgentTextRef.current)) {
          try {
            ws.send(JSON.stringify({ type: 'barge_in' }));
          } catch {}
          stopAllAudio();
          markLastAgentTurnInterrupted();
        }
      }

      if (final.trim()) {
        setTranscript(t => [...t, { role: 'customer', text: final.trim() }]);
        try {
          ws.send(JSON.stringify({ type: 'transcript', final: true, text: final.trim() }));
        } catch {}
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone access blocked. Please enable microphone permissions in your browser.');
      } else if (e.error === 'network') {
        setError('Speech recognition network error. Please verify your connection.');
      } else {
        console.warn('STT error', e.error);
      }
    };

    rec.onend = () => {
      if (!endedRef.current) {
        try {
          rec.start();
        } catch {}
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      console.error(e);
    }
  }

  function endCall() {
    endedRef.current = true;
    try {
      wsRef.current?.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
    } catch {}
    try {
      recRef.current?.stop();
    } catch {}
    stopAllAudio();
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
    }
  }

  const isCallFinished = !!summary || state === 'DONE';

  return (
    <main className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col justify-center px-4 py-8 sm:px-6">
      <div className="max-w-xl w-full mx-auto">
        {/* Error notification banner */}
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-xs sm:text-sm text-rose-200 flex items-start gap-3"
          >
            <span
              className="mt-0.5 inline-block h-2 w-2 rounded-full bg-rose-400"
              aria-hidden="true"
            />
            <div className="flex-1">
              <p className="font-semibold text-rose-300">Call Notice</p>
              <p className="mt-0.5 text-rose-200/90">{error}</p>
            </div>
          </div>
        )}

        {/* View 1: Before Call Centered Layout */}
        {!started && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 sm:p-10 text-center shadow-lg">
            <div className="mx-auto h-12 w-12 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-5">
              <span className="h-4 w-4 rounded-full bg-teal-400 animate-pulse" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-white">
              {business ? business.name : 'Missed-Call Rescuer'}
            </h1>

            <p className="mt-2 text-sm text-teal-300 font-medium">
              This is an automated assistant
            </p>

            <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
              Returning your missed call to answer questions, check availability, or take a message for the team.
            </p>

            <div className="mt-8">
              <button
                type="button"
                onClick={connect}
                className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-semibold text-base transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090d16]"
              >
                Start call
              </button>
            </div>

            <p className="mt-5 text-xs text-slate-500">
              Use headphones for the best experience.
            </p>

            <div className="mt-6 pt-5 border-t border-slate-800">
              <Link
                href="/"
                className="text-xs text-slate-400 hover:text-slate-300 underline transition-colors"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        )}

        {/* View 2: Active Call Layout */}
        {started && !isCallFinished && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6 shadow-xl flex flex-col gap-4">
            {/* Call Header with Business and Latency Chip */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <h1 className="text-base font-bold text-white tracking-tight">
                  {business ? business.name : 'Voice Assistant'}
                </h1>
                <p className="text-xs text-slate-400">
                  Automated Callback · Status: <span className="text-slate-300 capitalize">{status}</span>
                </p>
              </div>

              {/* Red End Call Button: Always visible during call */}
              <button
                type="button"
                onClick={endCall}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 self-start sm:self-auto"
              >
                End call
              </button>
            </div>

            {/* Latency Chip near the top */}
            {latestMetric && (
              <div className="rounded-lg bg-slate-950/60 border border-slate-800/80 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-400">
                  First-audio latency:{' '}
                  <span className="font-semibold text-teal-300">{latestMetric.totalMs} ms</span>
                </span>
                <span className="text-[11px] text-slate-500">
                  LLM: {latestMetric.llmFirstTokenMs !== null ? `${latestMetric.llmFirstTokenMs} ms` : '—'} · TTS: {latestMetric.ttsFirstAudioMs !== null ? `${latestMetric.ttsFirstAudioMs} ms` : '—'}
                </span>
              </div>
            )}

            {/* Agent State Visualizer */}
            <div className="flex justify-center py-2">
              <AgentStatusVisualizer state={state} />
            </div>

            {/* Live Transcript Chat Bubbles with Auto-Scroll */}
            <div
              role="log"
              aria-live="polite"
              aria-label="Call transcript"
              className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 h-80 overflow-y-auto flex flex-col"
            >
              {transcript.length === 0 ? (
                <div className="m-auto text-center py-8">
                  <p className="text-xs font-medium text-slate-400">
                    Connecting to voice assistant...
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Speak naturally once connected.
                  </p>
                </div>
              ) : (
                transcript.map((t, i) => (
                  <TranscriptBubble
                    key={i}
                    role={t.role}
                    text={t.text}
                    interrupted={t.interrupted}
                  />
                ))
              )}
              <div ref={transcriptBottomRef} />
            </div>

            {/* Call note footer */}
            <p className="text-[11px] text-center text-slate-500">
              Use headphones for the best experience. You can interrupt the assistant at any time.
            </p>
          </div>
        )}

        {/* View 3: Post-Call Summary Layout */}
        {started && isCallFinished && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-emerald-200 text-xs sm:text-sm flex items-center justify-between">
              <span>Call completed. Automated summary generated below:</span>
              <span className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold">Done</span>
            </div>

            {summary ? (
              <SummaryCard summary={summary} title="Post-Call Summary" />
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400 text-xs">
                <span className="inline-block h-4 w-4 rounded-full border-2 border-teal-500/30 border-t-teal-400 animate-spin mb-2" />
                <p>Finalizing post-call AI summary...</p>
              </div>
            )}

            <div className="pt-2 text-center">
              <Link
                href="/"
                className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                ← Back to dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
