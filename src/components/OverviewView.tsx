'use client';

import * as React from 'react';
import { useMemo } from 'react';
import { CallDetails, SummaryDetails } from './Drawer';
import { MissedCall } from '@/lib/useDashboardData';
import { StatCard } from './StatCard';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';
import { StatCardSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  PhoneMissed,
  PhoneCall,
  TrendingUp,
  Activity,
  ArrowRight,
  ExternalLink,
  X,
  ChevronRight,
  BarChart3,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface OverviewViewProps {
  missed: MissedCall[];
  calls: CallDetails[];
  summaries: Record<string, SummaryDetails>;
  initialLoading: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  completedCallsCount: number;
  recoveryRate: number | null;
  overallLatency: { avgTotal: number | null; avgLlm: number | null; avgTts: number | null } | null;
  callsWithLatencyCount?: number;
  lastCallId: string | null;
  lastCallToken?: string | null;
  onDismissBanner: () => void;
  onViewAllCalls: () => void;
  onSelectCall: (call: CallDetails) => void;
  onSimulate: () => void;
  simulating: boolean;
}

export function OverviewView({
  missed,
  calls,
  summaries,
  initialLoading,
  loadError,
  onRetry,
  completedCallsCount,
  recoveryRate,
  overallLatency,
  callsWithLatencyCount = 0,
  lastCallId,
  lastCallToken,
  onDismissBanner,
  onViewAllCalls,
  onSelectCall,
  onSimulate,
  simulating,
}: OverviewViewProps) {
  const recentCalls = calls.slice(0, 8);

  // Compute real data for latency chart
  const chartData = useMemo(() => {
    interface LatencyPoint {
      callId: string;
      label: string;
      fullTime: string;
      timestamp: number;
      total: number;
      llm: number;
      tts: number;
    }
    const points: LatencyPoint[] = [];

    // Filter calls with valid latency entries
    for (const c of calls) {
      if (!Array.isArray(c.latency) || c.latency.length === 0) continue;

      const totals: number[] = [];
      const llms: number[] = [];
      const ttss: number[] = [];

      for (const item of c.latency) {
        if (typeof item === 'number') {
          if (Number.isFinite(item) && item > 0) totals.push(item);
        } else if (typeof item === 'string') {
          const num = Number(item);
          if (Number.isFinite(num) && num > 0) totals.push(num);
        } else if (item && typeof item === 'object') {
          const itemRecord = item as Record<string, unknown>;
          const tot = typeof item.totalMs === 'number'
            ? item.totalMs
            : typeof itemRecord.totalMs === 'string'
              ? Number(itemRecord.totalMs)
              : null;
          if (tot !== null && Number.isFinite(tot) && tot > 0) {
            totals.push(tot);

            const llm = typeof item.llmFirstTokenMs === 'number'
              ? item.llmFirstTokenMs
              : typeof itemRecord.llmFirstTokenMs === 'string'
                ? Number(itemRecord.llmFirstTokenMs)
                : null;
            if (llm !== null && Number.isFinite(llm) && llm >= 0) llms.push(llm);

            const tts = typeof item.ttsFirstAudioMs === 'number'
              ? item.ttsFirstAudioMs
              : typeof itemRecord.ttsFirstAudioMs === 'string'
                ? Number(itemRecord.ttsFirstAudioMs)
                : null;
            if (tts !== null && Number.isFinite(tts) && tts >= 0) ttss.push(tts);
          }
        }
      }

      if (totals.length > 0) {
        const avgTot = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
        const avgL = llms.length ? Math.round(llms.reduce((a, b) => a + b, 0) / llms.length) : 0;
        const avgT = ttss.length ? Math.round(ttss.reduce((a, b) => a + b, 0) / ttss.length) : 0;

        let label = 'Call';
        let fullTime = '';
        let timestamp = 0;
        try {
          const d = new Date(c.start_time);
          timestamp = d.getTime();
          label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          fullTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {}

        points.push({
          callId: c.id.slice(0, 6),
          label,
          fullTime,
          timestamp,
          total: avgTot,
          llm: avgL,
          tts: avgT,
        });
      }
    }

    // Sort observations chronologically ascending and show up to the 10 most recent measurements
    points.sort((a, b) => a.timestamp - b.timestamp);
    return points.slice(-10);
  }, [calls]);

  const latencySubtitle =
    overallLatency?.avgTotal !== null && overallLatency?.avgTotal !== undefined
      ? `LLM: ${overallLatency.avgLlm ?? '—'} ms · TTS: ${overallLatency.avgTts ?? '—'} ms`
      : 'No latency metrics yet';

  return (
    <div className="space-y-6">
      {/* Simulation Banner */}
      {lastCallId && (
        <div
          role="status"
          className="rounded-xl border border-primary/30 bg-primary/10 p-4 sm:p-4.5 text-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs animate-in fade-in-50 duration-200"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0 animate-pulse" aria-hidden="true" />
            <div>
              <p className="text-xs sm:text-sm font-semibold text-foreground">
                Missed call simulated &amp; queued for callback
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Simulate customer voice session:{' '}
                <span className="font-mono text-primary font-medium">
                  {lastCallToken ? `/call/${lastCallToken}` : 'callback link unavailable'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              asChild
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5"
            >
              <a
                href={lastCallToken ? `/call/${lastCallToken}` : undefined}
                aria-disabled={!lastCallToken}
                className={!lastCallToken ? 'pointer-events-none opacity-50' : undefined}
                target="_blank"
                rel="noreferrer"
              >
                <span>Open call page</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDismissBanner}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss banner"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Row of 4 Stat Cards */}
      <section aria-label="Performance Metrics">
        {initialLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              title="Missed calls"
              value={missed.length}
              subtitle="Logged in queue"
              icon={PhoneMissed}
              tooltip="Total missed calls tracked in system"
            />
            <StatCard
              title="Calls completed"
              value={completedCallsCount}
              subtitle={`Based on ${calls.length} total call${calls.length === 1 ? '' : 's'}`}
              icon={PhoneCall}
              tooltip="Calls where customer spoke at least once and a valid summary was generated"
            />
            <StatCard
              title="Completed / missed calls"
              value={recoveryRate !== null ? `${recoveryRate}%` : '—'}
              subtitle={missed.length < 5 ? 'Needs ≥ 5 missed calls' : `${completedCallsCount} of ${missed.length} calls`}
              icon={TrendingUp}
              tooltip="Strict completion rate: completed calls / missed calls logged (hidden when < 5 missed calls)"
            />
            <StatCard
              title="End of speech to first audio"
              value={overallLatency?.avgTotal ? `${overallLatency.avgTotal} ms` : '—'}
              subtitle={callsWithLatencyCount > 0 ? `based on ${callsWithLatencyCount} call${callsWithLatencyCount === 1 ? '' : 's'}` : latencySubtitle}
              icon={Activity}
              tooltip={`Average round-trip response latency (based on ${callsWithLatencyCount} call${callsWithLatencyCount === 1 ? '' : 's'})`}
            />
          </div>
        )}
      </section>

      {/* Real-data Latency Chart */}
      <Card>
        <CardHeader className="p-4 sm:p-5 pb-2 sm:pb-3 flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <BarChart3 className="h-4 w-4 text-primary" />
              Round-Trip Audio Latency Trend
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Response time from end-of-speech to first audio output across recent calls (ms).
            </CardDescription>
          </div>
          {!initialLoading && !loadError && calls.length > 0 && (
            <Badge variant="outline" className="text-xs font-mono shrink-0">
              {chartData.length} {chartData.length === 1 ? 'measurement' : 'measurements'} recorded
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-4 sm:p-5 pt-0">
          {initialLoading ? (
            <div className="h-44 sm:h-52 w-full flex flex-col justify-center items-center gap-2 pt-4">
              <div className="h-32 w-full rounded-lg bg-muted/30 animate-pulse" />
              <div className="h-3.5 w-1/3 rounded bg-muted/40 animate-pulse" />
            </div>
          ) : loadError ? (
            <div className="h-36 flex flex-col items-center justify-center text-center p-4 rounded-lg bg-destructive/5 border border-destructive/20 text-xs text-muted-foreground my-2">
              <AlertCircle className="h-6 w-6 text-destructive mb-1.5" />
              <p className="font-semibold text-foreground">Unable to load latency metrics</p>
              <p className="mt-0.5 text-muted-foreground text-[11px] max-w-sm">{loadError}</p>
              {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry} className="mt-3 h-7 text-xs">
                  Retry connection
                </Button>
              )}
            </div>
          ) : calls.length === 0 ? (
            <div className="h-36 flex flex-col items-center justify-center text-center p-4 rounded-lg bg-muted/20 border border-border/60 text-xs text-muted-foreground my-2">
              <PhoneMissed className="h-6 w-6 text-muted-foreground/40 mb-1.5" />
              <p className="font-medium text-foreground">No calls recorded yet</p>
              <p className="mt-0.5 text-muted-foreground text-[11px] max-w-sm">
                Simulate a missed call to test the automated callback assistant and record response latency.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onSimulate}
                disabled={simulating}
                className="mt-3 h-7 text-xs font-medium"
              >
                Simulate missed call
              </Button>
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-36 flex flex-col items-center justify-center text-center p-4 rounded-lg bg-muted/20 border border-border/60 text-xs text-muted-foreground my-2">
              <Activity className="h-6 w-6 text-muted-foreground/40 mb-1.5" />
              <p className="font-medium text-foreground">No latency measurements recorded</p>
              <p className="mt-0.5 text-muted-foreground text-[11px] max-w-md">
                Latency is measured from end-of-speech to first audio output. The {calls.length} recorded call{calls.length === 1 ? '' : 's'} ended before customer speech or before an assistant response was generated.
              </p>
            </div>
          ) : chartData.length === 1 ? (
            <div className="p-4 rounded-lg bg-muted/20 border border-border/60 my-2 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border/40 pb-3">
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Single Observation</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xl font-bold font-mono text-primary">{chartData[0].total} ms</p>
                    <span className="text-xs text-muted-foreground">average round-trip</span>
                  </div>
                </div>
                <div className="text-left sm:text-right text-xs text-muted-foreground">
                  <p className="font-mono font-medium text-foreground">Call {chartData[0].callId}</p>
                  <p className="text-[11px]">{chartData[0].fullTime || chartData[0].label}</p>
                  {(chartData[0].llm > 0 || chartData[0].tts > 0) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                      LLM: {chartData[0].llm} ms · TTS: {chartData[0].tts} ms
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-primary shrink-0" />
                <p className="text-[11px]">
                  1 valid measurement recorded. At least 2 measurements are required to render the trend curve. Additional completed calls will populate the graph automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="h-48 sm:h-56 w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    unit="ms"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--card)',
                      borderColor: 'var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--foreground)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                    formatter={(value, _name, item) => {
                      const payload = item?.payload as { total?: number; llm?: number; tts?: number } | undefined;
                      const details = payload && (payload.llm || payload.tts) ? ` (LLM: ${payload.llm ?? 0} ms, TTS: ${payload.tts ?? 0} ms)` : '';
                      return [`${value} ms${details}`, 'Avg Latency'];
                    }}
                    labelFormatter={(label, payload) => {
                      const item = payload?.[0]?.payload as { callId?: string; fullTime?: string } | undefined;
                      const callId = item?.callId ? `Call ${item.callId} · ` : '';
                      return `${callId}${item?.fullTime || label}`;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#latencyGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Calls Section */}
      <Card>
        <CardHeader className="p-4 sm:p-5 pb-3 flex flex-row items-center justify-between gap-4 border-b border-border">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Calendar className="h-4 w-4 text-primary" />
              Recent Calls
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Showing the latest completed calls and AI callback sessions.
            </CardDescription>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAllCalls}
            className="text-xs gap-1 text-primary hover:text-primary font-medium"
          >
            <span>View all</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {recentCalls.length === 0 ? (
            loadError ? (
              <EmptyState
                title="Unable to load calls"
                description={loadError}
                actionText="Retry connection"
                onAction={onRetry || onSimulate}
                loading={initialLoading}
              />
            ) : (
              <EmptyState
                title="No calls recorded yet"
                description="Click 'Simulate missed call' in the top bar to test the automated callback agent."
                actionText="Simulate missed call"
                onAction={onSimulate}
                loading={simulating}
              />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[120px] text-xs">Time</TableHead>
                    <TableHead className="text-xs">Customer Phone</TableHead>
                    <TableHead className="text-xs">Outcome</TableHead>
                    <TableHead className="text-xs">Urgency</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Reason</TableHead>
                    <TableHead className="text-xs text-right w-[110px]">Latency</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCalls.map((call) => {
                    const summ = summaries[call.id];
                    // Compute call latency using robust numeric validation
                    let latencyDisplay = '—';
                    if (Array.isArray(call.latency) && call.latency.length > 0) {
                      const vals: number[] = [];
                      for (const l of call.latency) {
                        const tot = typeof l === 'number'
                          ? l
                          : typeof l === 'string'
                            ? Number(l)
                            : (l && typeof l === 'object')
                              ? (typeof l.totalMs === 'number' ? l.totalMs : Number((l as Record<string, unknown>).totalMs))
                              : null;
                        if (tot !== null && Number.isFinite(tot) && tot > 0) {
                          vals.push(tot);
                        }
                      }
                      if (vals.length > 0) {
                        latencyDisplay = `${Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)} ms`;
                      }
                    }

                    return (
                      <TableRow
                        key={call.id}
                        onClick={() => onSelectCall(call)}
                        className="cursor-pointer hover:bg-muted/40 transition-colors h-11"
                      >
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <RelativeTime date={call.start_time} />
                        </TableCell>
                        <TableCell className="text-xs font-mono font-medium text-foreground whitespace-nowrap">
                          {call.customer_phone}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <StatusBadge status={call.end_reason || 'in progress'} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {summ?.urgency ? (
                            <StatusBadge status={summ.urgency} label={summ.urgency} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground hidden md:table-cell max-w-[260px] truncate">
                          {summ?.reason || '—'}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono tabular-nums text-foreground whitespace-nowrap">
                          {latencyDisplay}
                        </TableCell>
                        <TableCell className="p-0 pr-3 text-right">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/60 inline-block" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
