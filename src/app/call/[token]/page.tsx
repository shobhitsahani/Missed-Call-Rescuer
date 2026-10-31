'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { API_BASE, api } from '@/lib/api';
import { SummaryCard } from '@/components/SummaryCard';
import { TranscriptBubble } from '@/components/TranscriptBubble';
import { AgentStatusVisualizer } from '@/components/AgentStatusVisualizer';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  PhoneCall,
  PhoneOff,
  Headphones,
  ArrowLeft,
  AlertCircle,
  Activity,
  CheckCircle2,
  Sparkles,
  Loader2,
  ShieldAlert,
} from 'lucide-react';

type TurnMetric = {
  totalMs: number;
  llmFirstTokenMs: number | null;
  ttsFirstAudioMs: number | null;
  turnDetectionMs?: number | null;
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
  const [sttProvider, setSttProvider] = useState<string>('assemblyai');
  const [status, setStatus] = useState('idle');
  const [started, setStarted] = useState(false);
  const [state, setState] = useState('GREETING');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [livePartial, setLivePartial] = useState<string>('');
  const [summary, setSummary] = useState<any>(null);
  const [latestMetric, setLatestMetric] = useState<TurnMetric | null>(null);
  const [_metricsHistory, setMetricsHistory] = useState<TurnMetric[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const endedRef = useRef(false);
  const stateRef = useRef(state);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Load business details for caller banner and STT provider flag
  useEffect(() => {
    api('/api/business')
      .then((b) => {
        setBusiness(b);
        if (b?.sttProvider) {
          setSttProvider(b.sttProvider);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll transcript container to latest message or partial
  useEffect(() => {
    if (transcriptBottomRef.current) {
      transcriptBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript, livePartial]);

  // Web Audio scheduling for incoming agent audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartRef = useRef(0);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // Barge-in guards (used when browser speech recognition fallback is active)
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
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
    };
  }

  const markLastAgentTurnInterrupted = useCallback(() => {
    setTranscript((prev) => {
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

  async function connect() {
    if (started) return;
    setStarted(true);
    setStatus('connecting');
    setError(null);
    initAudio();

    const provider = business?.sttProvider || sttProvider;

    // In AssemblyAI mode, acquire mic before connecting WS
    if (provider === 'assemblyai') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        mediaStreamRef.current = stream;

        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const micCtx = new AudioCtx();
        micCtxRef.current = micCtx;
        if (micCtx.state === 'suspended') {
          await micCtx.resume();
        }

        await micCtx.audioWorklet.addModule('/audio-processor.js');
        const micSource = micCtx.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(micCtx, 'pcm-audio-processor', {
          processorOptions: { targetSampleRate: 16000, chunkSamples: 800 },
        });
        workletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(event.data);
          }
        };

        micSource.connect(workletNode);
      } catch (err: any) {
        setStarted(false);
        setStatus('idle');
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Microphone access blocked. Please enable microphone permissions in your browser to start the call.');
        } else {
          setError(`Microphone error: ${err.message || 'Unable to access audio device.'}`);
        }
        return;
      }
    }

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
        case 'config':
          if (msg.sttProvider) {
            setSttProvider(msg.sttProvider);
          }
          break;
        case 'state':
          setState(msg.state);
          break;
        case 'agent_text':
          currentAgentTextRef.current = msg.text;
          setTranscript((t) => [...t, { role: 'agent', text: msg.text }]);
          break;
        case 'partial':
          setLivePartial(msg.text || '');
          break;
        case 'customer_transcript':
          setLivePartial('');
          setTranscript((t) => [...t, { role: 'customer', text: msg.text }]);
          break;
        case 'stop_audio':
          stopAllAudio();
          markLastAgentTurnInterrupted();
          break;
        case 'metrics': {
          const total = typeof msg.totalMs === 'number' ? msg.totalMs : msg.timeToFirstAudio;
          const llm = typeof msg.llmFirstTokenMs === 'number' ? msg.llmFirstTokenMs : null;
          const tts = typeof msg.ttsFirstAudioMs === 'number' ? msg.ttsFirstAudioMs : null;
          const turnDetection = typeof msg.turnDetectionMs === 'number' ? msg.turnDetectionMs : null;
          if (typeof total === 'number') {
            const m: TurnMetric = {
              totalMs: total,
              llmFirstTokenMs: llm,
              ttsFirstAudioMs: tts,
              turnDetectionMs: turnDetection,
            };
            setLatestMetric(m);
            setMetricsHistory((prev) => [...prev, m]);
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

    // If STT provider is browser fallback, setup SpeechRecognition
    if (provider === 'browser') {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) {
        setError('Browser speech recognition is not supported in this browser. Please use Chrome or Edge.');
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

        if (interim) {
          setLivePartial(interim);
        }

        // Barge-in guard evaluation in browser mode
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
          setLivePartial('');
          setTranscript((t) => [...t, { role: 'customer', text: final.trim() }]);
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
  }

  function endCall() {
    endedRef.current = true;
    try {
      wsRef.current?.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
    } catch {}

    // Cleanup mic stream & worklet
    try {
      workletNodeRef.current?.disconnect();
      workletNodeRef.current = null;
    } catch {}
    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    } catch {}
    try {
      micCtxRef.current?.close();
      micCtxRef.current = null;
    } catch {}

    // Cleanup browser recognition if active
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
    <main className="min-h-screen bg-background text-foreground flex flex-col justify-center px-4 py-8 sm:px-6 antialiased selection:bg-primary/20 selection:text-primary">
      <div className="max-w-xl w-full mx-auto space-y-4">
        {/* Error Notification Banner */}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs sm:text-sm text-foreground flex items-start gap-3 shadow-xs animate-in fade-in duration-200"
          >
            <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-destructive">Call Notice</p>
              <p className="mt-0.5 text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {/* View 1: Pre-call Focus Screen */}
        {!started && (
          <Card className="p-6 sm:p-10 text-center shadow-md">
            <CardContent className="p-0 flex flex-col items-center">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5 text-primary">
                <PhoneCall className="h-6 w-6 animate-pulse" />
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {business ? business.name : 'Missed-Call Rescuer'}
              </h1>

              <div className="mt-2.5">
                <Badge variant="outline" className="text-xs font-medium text-primary border-primary/30 bg-primary/5">
                  Automated Voice Assistant
                </Badge>
              </div>

              <p className="mt-3 text-xs sm:text-sm text-muted-foreground max-w-sm leading-relaxed">
                Returning your missed call to answer questions, check availability, or take a message for the team.
              </p>

              <div className="mt-8 w-full sm:w-auto">
                <Button
                  size="lg"
                  onClick={connect}
                  className="w-full sm:w-auto px-8 py-6 text-base font-semibold gap-2 shadow-sm"
                >
                  <PhoneCall className="h-5 w-5" />
                  <span>Start call</span>
                </Button>
              </div>

              <div className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Headphones className="h-3.5 w-3.5" />
                <span>Use headphones for the best experience.</span>
              </div>

              <div className="mt-8 pt-5 border-t border-border w-full">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                >
                  <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
                  <span>Back to dashboard</span>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* View 2: Active Call Layout */}
        {started && !isCallFinished && (
          <Card className="shadow-lg overflow-hidden">
            {/* Header with Business and End Call button */}
            <CardHeader className="p-4 sm:p-5 border-b border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-muted/20">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <CardTitle className="text-base font-bold text-foreground tracking-tight truncate">
                    {business ? business.name : 'Voice Assistant'}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Automated Callback · <span className="capitalize">{status}</span>
                </CardDescription>
              </div>

              {/* End Call Button: Prominent red button */}
              <Button
                variant="destructive"
                size="sm"
                onClick={endCall}
                className="gap-1.5 self-start sm:self-auto h-8 text-xs font-semibold shadow-xs"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                <span>End call</span>
              </Button>
            </CardHeader>

            <CardContent className="p-4 sm:p-5 space-y-4">
              {/* Latency metric strip at top */}
              {latestMetric && (
                <div className="rounded-lg bg-muted/40 border border-border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                    <span>First-audio latency:</span>
                    <span className="font-semibold text-primary font-mono">{latestMetric.totalMs} ms</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {typeof latestMetric.turnDetectionMs === 'number' && (
                      <>Turn: {latestMetric.turnDetectionMs} ms · </>
                    )}
                    LLM: {latestMetric.llmFirstTokenMs ?? '—'} ms · TTS: {latestMetric.ttsFirstAudioMs ?? '—'} ms
                  </div>
                </div>
              )}

              {/* Central Voice Status Visualizer */}
              <div className="flex justify-center py-2">
                <AgentStatusVisualizer state={state} />
              </div>

              {/* Scrollable Conversation Transcript Log */}
              <div
                role="log"
                aria-live="polite"
                aria-label="Call transcript"
                className="rounded-xl border border-border bg-muted/15 p-4 h-80 overflow-y-auto flex flex-col space-y-2 shadow-inner"
              >
                {transcript.length === 0 && !livePartial ? (
                  <div className="m-auto text-center py-8">
                    <p className="text-xs font-medium text-muted-foreground">
                      Connecting to voice assistant...
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-1">
                      Speak naturally once connected.
                    </p>
                  </div>
                ) : (
                  <>
                    {transcript.map((t, i) => (
                      <TranscriptBubble
                        key={i}
                        role={t.role}
                        text={t.text}
                        interrupted={t.interrupted}
                      />
                    ))}
                    {livePartial && (
                      <div className="flex gap-2 justify-end items-start mt-2">
                        <div className="px-3.5 py-2 rounded-2xl rounded-tr-xs bg-primary/20 border border-primary/30 text-xs text-foreground italic shadow-xs max-w-[85%] sm:max-w-[75%]">
                          <span>{livePartial}</span>
                          <span className="inline-block w-1.5 h-3 bg-primary animate-pulse ml-1 align-middle" />
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div ref={transcriptBottomRef} />
              </div>

              {/* Subtitle footer note */}
              <p className="text-[11px] text-center text-muted-foreground">
                You can speak or interrupt the assistant at any time.
              </p>
            </CardContent>
          </Card>
        )}

        {/* View 3: Post-Call Summary Layout */}
        {started && isCallFinished && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-foreground text-xs sm:text-sm flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="font-medium">Call completed successfully. AI summary generated:</span>
              </div>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-semibold uppercase text-[10px]">
                Completed
              </Badge>
            </div>

            {summary ? (
              <SummaryCard summary={summary} title="Post-Call Summary" />
            ) : (
              <Card className="p-8 text-center text-xs text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary mb-2" />
                <p>Finalizing post-call AI summary...</p>
              </Card>
            )}

            <div className="pt-2 text-center">
              <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs">
                <Link href="/">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to dashboard</span>
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
