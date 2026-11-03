'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getApiBase } from '@/lib/api';
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
  const [business, setBusiness] = useState<{ name: string; voice: string } | null>(null);
  const [status, setStatus] = useState('idle');
  const [started, setStarted] = useState(false);
  const [state, setState] = useState('GREETING');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [livePartial, setLivePartial] = useState<string>('');
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [latestMetric, setLatestMetric] = useState<TurnMetric | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [validatingToken, setValidatingToken] = useState(true);
  const [coldStartNotice, setColdStartNotice] = useState<string | null>(null);
  const [isReconnect, setIsReconnect] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<{ stop?: () => void } | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const endFallbackRef = useRef<NodeJS.Timeout | null>(null);
  const connectingRef = useRef(false);

  const endedRef = useRef(false);
  const summaryReceivedRef = useRef(false);
  const finalAudioSentRef = useRef(false);
  const playbackCompleteSentRef = useRef(false);
  const finalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef(state);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);
  const hasSpecificErrorRef = useRef(false);
  const audioStreamStartedRef = useRef(false);
  const assistantPlayedLoggedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Validate callback token and fetch session metadata via public endpoint
  // Accommodates Render free-tier cold starts with bounded retry and user feedback
  useEffect(() => {
    let isCancelled = false;
    let abortController: AbortController | null = null;
    let coldStartTimer: NodeJS.Timeout | null = null;

    async function validateTokenWithRetry() {
      const startTime = Date.now();
      const MAX_VALIDATE_DURATION_MS = 60000;
      let attempt = 0;

      coldStartTimer = setTimeout(() => {
        if (!isCancelled) {
          setColdStartNotice('Waking up the server. This may take up to a minute on Render free tier...');
        }
      }, 3500);

      while (!isCancelled) {
        attempt++;
        abortController = new AbortController();
        const attemptTimeout = setTimeout(() => abortController?.abort(), 20000);

        try {
          const res = await fetch(`${getApiBase()}/api/call-token/${encodeURIComponent(token)}`, {
            signal: abortController.signal,
          });
          clearTimeout(attemptTimeout);
          const data = await res.json().catch(() => null);
          if (isCancelled) return;

          if (!res.ok) {
            // Permanent errors: stop retrying immediately
            if (res.status === 400) {
              setTokenError(data?.error || 'Invalid or malformed callback link.');
              return;
            }
            if (res.status === 404) {
              setTokenError(data?.error || 'Callback session not found or link is invalid.');
              return;
            }
            if (res.status === 410) {
              setTokenError(data?.error || 'This callback link has expired (links are valid for 30 minutes).');
              return;
            }
            if (res.status === 409) {
              setTokenError(data?.error || 'This call has already concluded.');
              return;
            }
            if (res.status === 429) {
              setTokenError(data?.error || 'Demo is busy, try again in a minute.');
              return;
            }

            // Transient server errors (502, 503, 504): retry if within budget
            const elapsed = Date.now() - startTime;
            if (elapsed + 3000 < MAX_VALIDATE_DURATION_MS) {
              setColdStartNotice(`Connecting to server (attempt ${attempt})...`);
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            } else {
              setTokenError('The callback server is temporarily unavailable. Please try again in a moment.');
              return;
            }
          }

          if (data?.valid) {
            setBusiness({ name: data.businessName, voice: data.voice });
            if (data.isReconnect) {
              setIsReconnect(true);
            }
            setColdStartNotice(null);
            return;
          }
        } catch (err: unknown) {
          clearTimeout(attemptTimeout);
          if (isCancelled) return;
          const elapsed = Date.now() - startTime;
          if (elapsed + 3000 < MAX_VALIDATE_DURATION_MS) {
            setColdStartNotice('Waking up the server. This may take up to a minute on Render free tier...');
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          } else {
            const isAborted = err instanceof DOMException && err.name === 'AbortError';
            setTokenError(isAborted ? 'Connection timed out waiting for the server to wake up.' : 'Unable to connect to the callback server.');
            return;
          }
        }
      }
    }

    validateTokenWithRetry().finally(() => {
      if (coldStartTimer) clearTimeout(coldStartTimer);
      if (!isCancelled) {
        setValidatingToken(false);
      }
    });

    return () => {
      isCancelled = true;
      if (coldStartTimer) clearTimeout(coldStartTimer);
      if (abortController) abortController.abort();
    };
  }, [token]);

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
    if (audioCtxRef.current?.state === 'closed') {
      audioCtxRef.current = null;
    }
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx({ sampleRate: 24000 });
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return audioCtxRef.current;
  }

  const notifyPlaybackComplete = useCallback(() => {
    if (playbackCompleteSentRef.current) return;
    playbackCompleteSentRef.current = true;
    if (finalTimerRef.current) {
      clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'playback_complete' }));
      } catch {}
    }
  }, []);

  function playPcmChunk(arrayBuffer: ArrayBuffer) {
    const ctx = initAudio();
    if (ctx.state === 'closed') return;
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

    if (!assistantPlayedLoggedRef.current) {
      assistantPlayedLoggedRef.current = true;
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'client_event', event: 'assistant_audio_played' })); } catch {}
      }
    }
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
      if (finalAudioSentRef.current && sourcesRef.current.length === 0) {
        notifyPlaybackComplete();
      }
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

  function releaseMedia() {
    // Prevent SpeechRecognition.onend from restarting during teardown.
    endedRef.current = true;
    try {
      recRef.current?.stop?.();
    } catch {}
    recRef.current = null;
    try {
      workletNodeRef.current?.disconnect();
    } catch {}
    workletNodeRef.current = null;
    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    mediaStreamRef.current = null;
    try {
      micCtxRef.current?.close();
    } catch {}
    micCtxRef.current = null;
  }

  function releaseAudio() {
    stopAllAudio();
    if (finalTimerRef.current) {
      clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    nextStartRef.current = 0;
  }

  // Release mic, audio context and socket if the page is unmounted mid-call.
  useEffect(() => {
    return () => {
      endedRef.current = true;
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (endFallbackRef.current) clearTimeout(endFallbackRef.current);
      if (finalTimerRef.current) clearTimeout(finalTimerRef.current);
      releaseMedia();
      releaseAudio();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        try {
          ws.close();
        } catch {}
      }
    };
    // Cleanup helpers only touch refs; run once on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function connect(isAutoReconnect = false) {
    if (connectingRef.current) return;
    connectingRef.current = true;
    if (!isAutoReconnect) {
      reconnectAttemptsRef.current = 0;
    }
    hasSpecificErrorRef.current = false;
    endedRef.current = false;
    summaryReceivedRef.current = false;
    finalAudioSentRef.current = false;
    playbackCompleteSentRef.current = false;
    if (finalTimerRef.current) {
      clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }
    setStarted(true);
    setStatus('connecting');
    setError(null);
    setProgressMessage(isReconnect ? 'Resuming active call...' : 'Connecting audio...');
    initAudio();

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }
    connectionTimeoutRef.current = setTimeout(() => {
      if (stateRef.current === 'GREETING' && !endedRef.current) {
        setError('Connection timed out waiting for the assistant to start. Please check your connection and try again.');
      }
    }, 25000);

    const wsUrl = getApiBase().replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    // Capture microphone PCM and stream it to the server (server-side STT).
    async function setupMic(target: WebSocket) {
      if (mediaStreamRef.current) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (endedRef.current || target !== wsRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        if (target === wsRef.current && target.readyState === WebSocket.OPEN) {
          try { target.send(JSON.stringify({ type: 'client_event', event: 'microphone_permission_granted' })); } catch {}
        }

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const micCtx = new AudioCtx();
        micCtxRef.current = micCtx;
        if (micCtx.state === 'suspended') {
          await micCtx.resume();
        }

        await micCtx.audioWorklet.addModule('/audio-processor.js');
        if (target === wsRef.current && target.readyState === WebSocket.OPEN) {
          try { target.send(JSON.stringify({ type: 'client_event', event: 'audioworklet_ready' })); } catch {}
        }
        const micSource = micCtx.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(micCtx, 'pcm-audio-processor', {
          processorOptions: { targetSampleRate: 16000, chunkSamples: 800 },
        });
        workletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (target === wsRef.current && target.readyState === WebSocket.OPEN) {
            if (!audioStreamStartedRef.current) {
              audioStreamStartedRef.current = true;
              try { target.send(JSON.stringify({ type: 'client_event', event: 'audio_stream_started' })); } catch {}
            }
            target.send(event.data);
          }
        };

        micSource.connect(workletNode);
        setProgressMessage('Listening...');
      } catch (err: unknown) {
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        hasSpecificErrorRef.current = true;
        try { target.close(); } catch {}
        if (target === wsRef.current) wsRef.current = null;
        connectingRef.current = false;
        endedRef.current = true;
        releaseMedia();
        setStarted(false);
        setStatus('idle');
        const errObj = err as Error;
        if (errObj.name === 'NotAllowedError' || errObj.name === 'PermissionDeniedError') {
          setError('Microphone access blocked. Please enable microphone permissions in your browser to start the call.');
        } else {
          setError(`Microphone error: ${errObj.message || 'Unable to access audio device.'}`);
        }
      }
    }

    // Browser SpeechRecognition fallback (no server-side STT).
    function startBrowserStt(target: WebSocket) {
      if (recRef.current) return;
      type SpeechRecognitionCtor = new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        start: () => void;
        stop: () => void;
        onresult: (e: {
          resultIndex: number;
          results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
        }) => void;
        onerror: (e: { error: string }) => void;
        onend: () => void;
      };
      const win = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      };
      const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (!SR) {
        setError('Browser speech recognition is not supported in this browser. Please use Chrome or Edge.');
        try { target.close(); } catch {}
        if (target === wsRef.current) wsRef.current = null;
        connectingRef.current = false;
        setStarted(false);
        setStatus('idle');
        return;
      }

      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onresult = (e) => {
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
              target.send(JSON.stringify({ type: 'barge_in' }));
            } catch {}
            stopAllAudio();
            markLastAgentTurnInterrupted();
          }
        }

        if (final.trim()) {
          setLivePartial('');
          setTranscript((t) => [...t, { role: 'customer', text: final.trim() }]);
          try {
            target.send(JSON.stringify({ type: 'transcript', final: true, text: final.trim() }));
          } catch {}
        }
      };

      rec.onerror = (e: { error: string }) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setError('Microphone access blocked. Please enable microphone permissions in your browser.');
        } else if (e.error === 'network') {
          setError('Speech recognition network error. Please verify your connection.');
        } else {
          console.warn('STT error', e.error);
        }
      };

      rec.onend = () => {
        if (!endedRef.current && !summaryReceivedRef.current && target.readyState === WebSocket.OPEN) {
          try {
            rec.start();
          } catch {}
        }
      };

      recRef.current = rec;
      try {
        rec.start();
        setProgressMessage('Listening...');
      } catch (e) {
        console.error(e);
      }
    }

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'join', token }));
    };

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        playPcmChunk(ev.data);
        return;
      }
      let msg: {
        type?: string;
        sttProvider?: string;
        message?: string;
        state?: string;
        text?: string;
        isFinal?: boolean;
        totalMs?: number;
        timeToFirstAudio?: number;
        llmFirstTokenMs?: number | null;
        ttsFirstAudioMs?: number | null;
        turnDetectionMs?: number | null;
        summary?: Record<string, unknown>;
      };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'config':
          if (msg.sttProvider) {
            // The provider is known only after the server replies, so wire the
            // microphone path here instead of guessing at connect time.
            if (msg.sttProvider === 'browser') {
              startBrowserStt(ws);
            } else {
              void setupMic(ws);
            }
          }
          break;
        case 'progress':
          if (msg.message) {
            setProgressMessage(msg.message);
          }
          break;
        case 'state':
          if (msg.state) {
            setState(msg.state);
            if (msg.state === 'SPEAKING' || msg.state === 'LISTENING') {
              if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
            }
            if (msg.state === 'FINALIZING') {
              setProgressMessage('Wrapping up call...');
              if (workletNodeRef.current) {
                try { workletNodeRef.current.disconnect(); } catch {}
                workletNodeRef.current = null;
              }
              try { recRef.current?.stop?.(); } catch {}
            }
          }
          break;
        case 'agent_audio_end':
          if (msg.isFinal) {
            finalAudioSentRef.current = true;
            if (workletNodeRef.current) {
              try { workletNodeRef.current.disconnect(); } catch {}
              workletNodeRef.current = null;
            }
            try { recRef.current?.stop?.(); } catch {}

            const ctx = audioCtxRef.current;
            const isPlaying = sourcesRef.current.length > 0 && ctx && ctx.state !== 'closed' && nextStartRef.current > ctx.currentTime;
            if (!isPlaying) {
              notifyPlaybackComplete();
            } else if (ctx) {
              const remainingMs = Math.max(0, (nextStartRef.current - ctx.currentTime) * 1000);
              if (finalTimerRef.current) clearTimeout(finalTimerRef.current);
              finalTimerRef.current = setTimeout(() => {
                notifyPlaybackComplete();
              }, remainingMs + 50);
            }
          }
          break;
        case 'agent_text':
          if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
          currentAgentTextRef.current = msg.text || '';
          setTranscript((t) => [...t, { role: 'agent', text: msg.text || '' }]);
          break;
        case 'partial':
          setLivePartial(msg.text || '');
          break;
        case 'customer_transcript':
          setLivePartial('');
          setTranscript((t) => [...t, { role: 'customer', text: msg.text || '' }]);
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
          }
          break;
        }
        case 'summary':
          summaryReceivedRef.current = true;
          endedRef.current = true;
          if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
          if (endFallbackRef.current) clearTimeout(endFallbackRef.current);
          setSummary(msg.summary || null);
          setProgressMessage('Call complete');
          releaseMedia();
          stopAllAudio();
          break;
        case 'error':
          if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
          hasSpecificErrorRef.current = true;
          setError(msg.message || 'An unexpected error occurred during the call.');
          break;
      }
    };

    ws.onclose = (event: CloseEvent) => {
      connectingRef.current = false;
      setStatus('closed');
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (summaryReceivedRef.current || endedRef.current) {
        releaseMedia();
        stopAllAudio();
        return;
      }
      releaseMedia();
      stopAllAudio();
      setStarted(false);
      setStatus('idle');

      // If a specific error was received from backend or mic, preserve it
      if (hasSpecificErrorRef.current) {
        return;
      }

      // If close reason exists from backend
      if (event.reason) {
        hasSpecificErrorRef.current = true;
        setError(event.reason);
        return;
      }

      // Bounded reconnection if active call dropped unexpectedly
      if (stateRef.current !== 'GREETING' && reconnectAttemptsRef.current < 3) {
        reconnectAttemptsRef.current += 1;
        setProgressMessage(`Connection interrupted. Reconnecting (attempt ${reconnectAttemptsRef.current}/3)...`);
        const delay = reconnectAttemptsRef.current * 1000;
        setTimeout(() => {
          if (!endedRef.current && !summaryReceivedRef.current) {
            void connect(true);
          }
        }, delay);
        return;
      }

      setError('The call connection closed before the assistant finished. Please try again.');
    };

    ws.onerror = () => {
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      setError('Connection lost. Could not communicate with the voice server.');
    };
  }

  function endCall() {
    endedRef.current = true;
    connectingRef.current = false;
    try {
      wsRef.current?.send(JSON.stringify({ type: 'end', reason: 'user_ended' }));
    } catch {}
    if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);

    releaseMedia();
    releaseAudio();
    setStatus('ending');
    setProgressMessage('Ending call — generating summary...');

    // The server keeps the socket open long enough to stream the summary.
    // If it never arrives (provider outage), fall back to the dashboard view.
    if (endFallbackRef.current) clearTimeout(endFallbackRef.current);
    endFallbackRef.current = setTimeout(() => {
      if (summaryReceivedRef.current) return;
      const socket = wsRef.current;
      wsRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try { socket.close(); } catch {}
      }
      setStarted(false);
      setStatus('idle');
      setError('The call ended, but the summary is still processing. It will appear on the dashboard when ready.');
    }, 45000);
  }

  function retryCall() {
    endedRef.current = true;
    connectingRef.current = false;
    hasSpecificErrorRef.current = false;
    reconnectAttemptsRef.current = 0;
    audioStreamStartedRef.current = false;
    assistantPlayedLoggedRef.current = false;
    if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
    if (endFallbackRef.current) clearTimeout(endFallbackRef.current);
    releaseMedia();
    releaseAudio();

    // Detach and close the old socket so late events cannot mutate the retry.
    const oldSocket = wsRef.current;
    wsRef.current = null;
    if (oldSocket) {
      oldSocket.onopen = null;
      oldSocket.onmessage = null;
      oldSocket.onclose = null;
      oldSocket.onerror = null;
      try { oldSocket.close(); } catch {}
    }

    summaryReceivedRef.current = false;
    finalAudioSentRef.current = false;
    playbackCompleteSentRef.current = false;
    if (finalTimerRef.current) {
      clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }
    setError(null);
    setProgressMessage(null);
    setStarted(false);
    setStatus('idle');
    setState('GREETING');
    setTranscript([]);
    setLivePartial('');
    setSummary(null);
    setLatestMetric(null);
    setTimeout(() => {
      void connect();
    }, 250);
  }

  const isCallFinished = !!summary || state === 'DONE';

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center px-4 py-8 sm:py-12 sm:px-6 antialiased selection:bg-primary/20 selection:text-primary">
      <div className="w-full max-w-[520px] mx-auto space-y-4">
        {/* Token Validation Error Banner */}
        {tokenError && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs sm:text-sm text-foreground flex items-start gap-3 shadow-xs animate-in fade-in duration-200"
          >
            <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-destructive">Callback Session Unavailable</p>
              <p className="mt-0.5 text-muted-foreground">{tokenError}</p>
            </div>
          </div>
        )}

        {/* Error Notification Banner */}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs sm:text-sm text-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs animate-in fade-in duration-200"
          >
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-destructive">Could not connect voice assistant</p>
                <p className="mt-0.5 text-muted-foreground">{error}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={retryCall}
              className="border-destructive/30 hover:bg-destructive/15 text-destructive font-semibold h-8 text-xs shrink-0 self-end sm:self-center"
            >
              Try again
            </Button>
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
                  Voice Callback Session
                </Badge>
              </div>

              <p className="mt-3 text-xs sm:text-sm text-muted-foreground max-w-sm leading-relaxed">
                Returning your missed call to answer questions, check availability, or take a message for the team.
              </p>

              <div className="mt-8 w-full sm:w-auto">
                <Button
                  size="lg"
                  onClick={() => void connect()}
                  disabled={validatingToken || !!tokenError}
                  className="w-full sm:w-auto px-8 py-6 text-base font-semibold gap-2 shadow-sm"
                >
                  {validatingToken ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Validating link...</span>
                    </>
                  ) : isReconnect ? (
                    <>
                      <PhoneCall className="h-5 w-5" />
                      <span>Resume call</span>
                    </>
                  ) : (
                    <>
                      <PhoneCall className="h-5 w-5" />
                      <span>Start call</span>
                    </>
                  )}
                </Button>
                {coldStartNotice && (
                  <p className="mt-3 text-xs text-amber-500 font-medium animate-pulse text-center max-w-xs">
                    {coldStartNotice}
                  </p>
                )}
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
                <AgentStatusVisualizer state={state} progressText={progressMessage} />
              </div>

              {/* Scrollable Conversation Transcript Log */}
              <div
                role="log"
                aria-live="polite"
                aria-label="Call transcript"
                className="rounded-xl border border-border bg-muted/15 p-4 h-80 overflow-y-auto flex flex-col space-y-2 shadow-inner"
              >
                {transcript.length === 0 && !livePartial ? (
                  <div className="m-auto text-center py-8 px-4">
                    {error ? (
                      <div className="space-y-3">
                        <div className="h-10 w-10 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto text-destructive">
                          <AlertCircle className="h-5 w-5" />
                        </div>
                        <p className="text-xs font-semibold text-destructive">
                          Could not connect the voice assistant
                        </p>
                        <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                          {error}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={retryCall}
                          className="mt-2 text-xs h-8 gap-1.5"
                        >
                          Try again
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary mb-2" />
                        <p className="text-xs font-medium text-muted-foreground">
                          {progressMessage || 'Connecting to voice assistant...'}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 mt-1">
                          Speak naturally once connected.
                        </p>
                      </>
                    )}
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
