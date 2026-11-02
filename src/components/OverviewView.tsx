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
    const points: { callId: string; label: string; total: number; llm: number; tts: number }[] = [];
    // Process calls with latency data (up to last 10 in chronological order)
    const validCalls = calls
      .filter((c) => Array.isArray(c.latency) && c.latency.length > 0)
      .slice(0, 10)
      .reverse();

    for (const c of validCalls) {
      const totals: number[] = [];
      const llms: number[] = [];
      const ttss: number[] = [];

      for (const item of c.latency) {
        if (typeof item === 'number') {
          totals.push(item);
        } else if (item && typeof item === 'object') {
          if (typeof item.totalMs === 'number') totals.push(item.totalMs);
          if (typeof item.llmFirstTokenMs === 'number') llms.push(item.llmFirstTokenMs);
          if (typeof item.ttsFirstAudioMs === 'number') ttss.push(item.ttsFirstAudioMs);
        }
      }

      if (totals.length > 0) {
        const avgTot = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
        const avgL = llms.length ? Math.round(llms.reduce((a, b) => a + b, 0) / llms.length) : 0;
        const avgT = ttss.length ? Math.round(ttss.reduce((a, b) => a + b, 0) / ttss.length) : 0;

        let label = 'Call';
        try {
          const d = new Date(c.start_time);
          label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {}

        points.push({
          callId: c.id.slice(0, 6),
          label,
          total: avgTot,
          llm: avgL,
          tts: avgT,
        });
      }
    }
    return points;
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
          {chartData.length > 0 && (
            <Badge variant="outline" className="text-xs font-mono shrink-0">
              {chartData.length} {chartData.length === 1 ? 'call' : 'calls'} recorded
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-4 sm:p-5 pt-0">
          {chartData.length >= 2 ? (
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
                    formatter={(value) => [`${value} ms`, 'Avg Latency']}
                    labelFormatter={(label) => `Time: ${label}`}
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
          ) : (
            <div className="h-32 flex flex-col items-center justify-center text-center p-4 rounded-lg bg-muted/20 border border-border/60 text-xs text-muted-foreground my-2">
              <Activity className="h-6 w-6 text-muted-foreground/40 mb-1.5" />
              <p className="font-medium text-foreground">Awaiting multiple call runs</p>
              <p className="mt-0.5 text-muted-foreground text-[11px]">
                Simulate 2 or more calls to view the latency trend curve with real data.
              </p>
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
                    // Compute call latency
                    let latencyDisplay = '—';
                    if (Array.isArray(call.latency) && call.latency.length > 0) {
                      const vals: number[] = [];
                      for (const l of call.latency) {
                        if (typeof l === 'number') vals.push(l);
                        else if (l && typeof l.totalMs === 'number') vals.push(l.totalMs);
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
