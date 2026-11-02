'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE, api } from '@/lib/api';
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
  const [simulating, setSimulating] = useState(false);
  const [lastCallId, setLastCallId] = useState<string | null>(null);
  const [lastCallToken, setLastCallToken] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, m, c] = await Promise.all([
        api('/api/business').catch(() => null),
        api('/api/missed-calls').catch(() => []),
        api('/api/calls').catch(() => []),
      ]);

      if (b) {
        setBusiness(b);
      }
      setMissed(m || []);
      setCalls(c || []);

      if (Array.isArray(c)) {
        const map: Record<string, SummaryDetails> = {};
        await Promise.all(
          c.map(async (call: CallDetails) => {
            try {
              const s = await api(`/api/summaries/${call.id}`);
              if (s) map[call.id] = s;
            } catch {}
          })
        );
        setSummaries((prev) => ({ ...prev, ...map }));
      }
    } catch (e: unknown) {
      console.error('Failed to load dashboard data:', e);
    } finally {
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

  // Open SSE event subscription directly without stream token
  useEffect(() => {
    let es: EventSource | null = null;

    try {
      es = new EventSource(`${API_BASE}/api/events`);

      es.onopen = () => setSseConnected(true);
      es.onerror = () => {
        setSseConnected(false);
      };

      es.onmessage = () => {
        setSseConnected(true);
        load();
      };

      es.addEventListener('call_updated', () => {
        setSseConnected(true);
        load();
      });

      es.addEventListener('missed_call', () => {
        setSseConnected(true);
        load();
      });

      es.addEventListener('call_ended', () => {
        setSseConnected(true);
        load();
      });

      es.addEventListener('data_cleared', () => {
        setSseConnected(true);
        load();
      });

      es.addEventListener('summary_ready', (e: Event) => {
        setSseConnected(true);
        try {
          const me = e as MessageEvent;
          const d = JSON.parse(me.data);
          if (d.summary) {
            setSummaries((prev) => ({ ...prev, [d.callId]: d.summary }));
          }
        } catch {}
        load();
      });
    } catch (err: unknown) {
      console.error('Failed to initialize SSE connection:', err);
    }

    return () => {
      if (es) {
        es.close();
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
      if (r?.missedCallId) {
        setLastCallId(r.missedCallId);
      }
      if (r?.token) {
        setLastCallToken(r.token);
      }
      await load();
      return r;
    } catch (e: unknown) {
      console.error('Simulate missed call failed:', e);
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
    simulating,
    lastCallId,
    setLastCallId,
    lastCallToken,
    setLastCallToken,
    sseConnected,
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
