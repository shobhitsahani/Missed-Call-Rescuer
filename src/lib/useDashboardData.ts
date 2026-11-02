'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { api, getApiBase } from '@/lib/api';
import { CallDetails, SummaryDetails, TurnDetails, LatencyItem } from '@/components/Drawer';

export type MissedCall = {
  id: string;
  customer_phone: string;
  time: string;
  status: string;
  token?: string;
  token_expires_at?: string;
  source?: 'demo' | 'test';
};

export function computeAverages(rawLatency: LatencyItem[] = []) {
  if (!rawLatency || !rawLatency.length) return null;
  const totals: number[] = [];
  const llms: number[] = [];
  const ttss: number[] = [];
  const turnDetections: number[] = [];

  for (const item of rawLatency) {
    if (typeof item === 'number') {
      totals.push(item);
    } else if (item && typeof item === 'object') {
      if (typeof item.totalMs === 'number') totals.push(item.totalMs);
      if (typeof item.llmFirstTokenMs === 'number') llms.push(item.llmFirstTokenMs);
      if (typeof item.ttsFirstAudioMs === 'number') ttss.push(item.ttsFirstAudioMs);
      if (typeof item.turnDetectionMs === 'number') turnDetections.push(item.turnDetectionMs);
    }
  }

  const avgTotal = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null;
  const avgLlm = llms.length ? Math.round(llms.reduce((a, b) => a + b, 0) / llms.length) : null;
  const avgTts = ttss.length ? Math.round(ttss.reduce((a, b) => a + b, 0) / ttss.length) : null;
  const avgTurn = turnDetections.length ? Math.round(turnDetections.reduce((a, b) => a + b, 0) / turnDetections.length) : null;

  return { avgTotal, avgLlm, avgTts, avgTurn };
}

export function useDashboardData() {
  const [business, setBusiness] = useState<Record<string, unknown> | null>(null);
  const [missed, setMissed] = useState<MissedCall[]>([]);
  const [calls, setCalls] = useState<CallDetails[]>([]);
  const [summaries, setSummaries] = useState<Record<string, SummaryDetails>>({});
  const [turnsMap, setTurnsMap] = useState<Record<string, TurnDetails[]>>({});
  const [loadingTurns, setLoadingTurns] = useState<Record<string, boolean>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const [lastCallToken, setLastCallToken] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [sseError, setSseError] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;

    const run = (async () => {
      const [bizResult, missedResult, callsResult, summariesResult] = await Promise.allSettled([
        api('/api/business'),
        api('/api/missed-calls'),
        api('/api/calls'),
        api('/api/summaries'),
      ]);

      let failures = 0;

      if (bizResult.status === 'fulfilled' && bizResult.value) {
        setBusiness(bizResult.value);
      } else {
        failures++;
      }

      if (missedResult.status === 'fulfilled' && Array.isArray(missedResult.value)) {
        setMissed(missedResult.value);
      } else {
        failures++;
      }

      let callsData: CallDetails[] = [];
      if (callsResult.status === 'fulfilled' && Array.isArray(callsResult.value)) {
        callsData = callsResult.value as CallDetails[];
        setCalls(callsData);
      } else {
        failures++;
      }

      // Populate summaries efficiently:
      // If bulk /api/summaries endpoint succeeded, build map in O(N) with 0 extra HTTP requests
      if (summariesResult.status === 'fulfilled' && Array.isArray(summariesResult.value)) {
        const map: Record<string, SummaryDetails> = {};
        for (const item of summariesResult.value) {
          const s = item as SummaryDetails | null;
          if (s && s.call_id) {
            map[s.call_id] = s;
          }
        }
        setSummaries((prev) => ({ ...prev, ...map }));
      } else if (callsData.length > 0) {
        // Fallback for older servers without bulk endpoint: fetch only recent calls (max 10) asynchronously
        const recent = callsData.slice(0, 10);
        void Promise.all(
          recent.map(async (call) => {
            try {
              const s = await api(`/api/summaries/${call.id}`);
              if (s) setSummaries((prev) => ({ ...prev, [call.id]: s }));
            } catch {}
          })
        );
      }

      if (failures >= 3) {
        setLoadError('Cannot reach the backend. Check that the API is running and that the API base URL is correct.');
      } else if (failures > 0) {
        setLoadError('Some dashboard data could not be loaded. Live sync will retry automatically.');
      } else {
        setLoadError(null);
      }
    })();

    inFlightRef.current = run;
    try {
      await run;
    } finally {
      inFlightRef.current = null;
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const timer = setTimeout(() => {
      if (!ignore) {
        void load();
      }
    }, 0);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [load]);

  // SSE event subscription with bounded exponential backoff
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isDisposed = false;
    let backoffMs = 1000;
    const MAX_BACKOFF_MS = 15000;

    const connect = () => {
      if (isDisposed) return;
      if (es) {
        try { es.close(); } catch {}
      }

      try {
        es = new EventSource(`${getApiBase()}/api/events`);

        const markConnected = () => {
          if (isDisposed) return;
          backoffMs = 1000; // Reset backoff on successful connection
          setSseConnected(true);
          setSseError(false);
        };

        es.onopen = markConnected;

        es.onerror = () => {
          if (isDisposed) return;
          setSseConnected(false);
          setSseError(true);
          try { es?.close(); } catch {}
          es = null;

          // Schedule reconnect with bounded exponential backoff and jitter
          if (!reconnectTimer && !isDisposed) {
            const jitter = Math.floor(Math.random() * 300);
            const delay = Math.min(backoffMs + jitter, MAX_BACKOFF_MS);
            backoffMs = Math.min(backoffMs * 1.5, MAX_BACKOFF_MS);

            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              if (!isDisposed) {
                connect();
                void load(); // Refresh data on reconnect
              }
            }, delay);
          }
        };

        es.onmessage = () => {
          markConnected();
          void load();
        };

        es.addEventListener('connected', markConnected);

        es.addEventListener('call_updated', () => {
          markConnected();
          void load();
        });

        es.addEventListener('missed_call', () => {
          markConnected();
          void load();
        });

        es.addEventListener('call_ended', () => {
          markConnected();
          void load();
        });

        es.addEventListener('data_cleared', () => {
          markConnected();
          void load();
        });

        es.addEventListener('summary_ready', (e: Event) => {
          markConnected();
          try {
            const me = e as MessageEvent;
            const d = JSON.parse(me.data);
            if (d.summary) {
              setSummaries((prev) => ({ ...prev, [d.callId]: d.summary }));
            }
          } catch {}
          void load();
        });
      } catch (err: unknown) {
        console.error('Failed to initialize SSE connection:', err);
        setSseConnected(false);
        setSseError(true);
        if (!reconnectTimer && !isDisposed) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!isDisposed) connect();
          }, 3000);
        }
      }
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) {
        try { es.close(); } catch {}
      }
      setSseConnected(false);
    };
  }, [load]);

  const simulate = useCallback(async () => {
    setSimulating(true);
    try {
      const r = await api('/api/missed-calls/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'demo' }),
      });
      const token = r?.token;
      if (r?.missedCallId) {
        setLastCallId(r.missedCallId);
      }
      if (token) {
        setLastCallToken(token);
      }
      await load();
      if (token) {
        toast.success('Simulated missed call queued. Callback link ready.', {
          action: {
            label: 'Open call',
            onClick: () => window.open(`/call/${token}`, '_blank'),
          },
        });
      } else {
        toast.success('Simulated missed call queued.');
      }
      return r;
    } catch (e: unknown) {
      console.error('Simulate missed call failed:', e);
      const errMsg = e instanceof Error ? e.message : 'Failed to simulate missed call.';
      toast.error(errMsg);
      throw e;
    } finally {
      setSimulating(false);
    }
  }, [load]);

  const clearTestData = useCallback(async (scope: 'all' | 'test_only' = 'all') => {
    try {
      await api('/api/admin/clear-test-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      await load();
    } catch (e: unknown) {
      console.error('Clear test data failed:', e);
      throw e;
    }
  }, [load]);

  const fetchTurns = useCallback(async (callId: string) => {
    if (turnsMap[callId]) return;
    setLoadingTurns((prev) => ({ ...prev, [callId]: true }));
    try {
      const details = await api(`/api/calls/${callId}`);
      if (details?.turns) {
        setTurnsMap((prev) => ({ ...prev, [callId]: details.turns }));
      }
    } catch (err) {
      console.error('Failed to load call turns', err);
    } finally {
      setLoadingTurns((prev) => ({ ...prev, [callId]: false }));
    }
  }, [turnsMap]);

  const overallLatency = useMemo(() => {
    const allItems: LatencyItem[] = [];
    for (const c of calls) {
      if (Array.isArray(c.latency)) allItems.push(...c.latency);
    }
    return computeAverages(allItems);
  }, [calls]);

  const callsWithLatencyCount = useMemo(() => {
    return calls.filter((c) => Array.isArray(c.latency) && c.latency.length > 0).length;
  }, [calls]);

  // Strict honest completed call definition: customer spoke at least once AND valid summary generated (not failed reason)
  const completedCallsCount = useMemo(() => {
    return calls.filter((c) => c.is_completed === true).length;
  }, [calls]);

  // Completion rate (completed calls / missed calls logged); hidden when fewer than 5 missed calls exist
  const completionRate = useMemo(() => {
    if (missed.length < 5) return null;
    return Math.min(100, Math.round((completedCallsCount / missed.length) * 100));
  }, [completedCallsCount, missed.length]);

  return {
    business,
    missed,
    calls,
    summaries,
    turnsMap,
    loadingTurns,
    initialLoading,
    loadError,
    simulating,
    lastCallId,
    setLastCallId,
    lastCallToken,
    setLastCallToken,
    sseConnected,
    sseError,
    simulate,
    clearTestData,
    fetchTurns,
    overallLatency,
    callsWithLatencyCount,
    completedCallsCount,
    completionRate,
    load,
  };
}
