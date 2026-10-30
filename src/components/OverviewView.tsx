'use client';

import { CallDetails, SummaryDetails } from './Drawer';
import { MissedCall, computeAverages } from '@/lib/useDashboardData';
import { StatCard } from './StatCard';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';
import { StatCardSkeleton, TableRowSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

interface OverviewViewProps {
  missed: MissedCall[];
  calls: CallDetails[];
  summaries: Record<string, SummaryDetails>;
  initialLoading: boolean;
  completedCallsCount: number;
  recoveryRate: number | null;
  overallLatency: { avgTotal: number | null; avgLlm: number | null; avgTts: number | null } | null;
  lastCallId: string | null;
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
  completedCallsCount,
  recoveryRate,
  overallLatency,
  lastCallId,
  onDismissBanner,
  onViewAllCalls,
  onSelectCall,
  onSimulate,
  simulating,
}: OverviewViewProps) {
  const recentCalls = calls.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Simulation Banner */}
      {lastCallId && (
        <div
          role="status"
          className="rounded-xl border border-teal-500/30 bg-teal-950/20 p-4 sm:p-4.5 text-teal-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span className="mt-1 h-2 w-2 rounded-full bg-teal-400 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-xs sm:text-sm font-semibold text-teal-200">
                Missed call simulated &amp; queued for callback
              </p>
              <p className="text-xs text-teal-300/80 mt-0.5">
                Simulate the customer conversation:{' '}
                <span className="font-mono text-teal-200">/call/{lastCallId}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <a
              href={`/call/${lastCallId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold tracking-wide transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
            >
              Open call page
            </a>
            <button
              type="button"
              onClick={onDismissBanner}
              className="p-1.5 text-teal-400/80 hover:text-teal-200 rounded-md hover:bg-teal-900/30 transition-colors"
              aria-label="Dismiss banner"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
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
              subtitle="Total logged missed calls"
            />
            <StatCard
              title="Calls completed"
              value={completedCallsCount}
              subtitle="Voice agent callbacks"
            />
            <StatCard
              title="Recovery rate"
              value={recoveryRate !== null ? `${recoveryRate}%` : '—'}
              subtitle={recoveryRate !== null ? `${completedCallsCount} of ${missed.length} recovered` : 'No call data yet'}
              tooltip="Percentage of missed calls successfully handled by voice agent"
            />
            <StatCard
              title="Avg time to first audio"
              value={overallLatency?.avgTotal ? `${overallLatency.avgTotal} ms` : '—'}
              subtitle={
                overallLatency && (overallLatency.avgLlm !== null || overallLatency.avgTts !== null)
                  ? `LLM: ${overallLatency.avgLlm ?? '—'} ms · TTS: ${overallLatency.avgTts ?? '—'} ms`
                  : 'End of speech to first audio'
              }
              tooltip="End of customer speech to first playable audio chunk"
            />
          </div>
        )}
      </section>

      {/* Recent Calls Section */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0e131f] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white tracking-tight">
              Recent calls
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Latest voice callback interactions
            </p>
          </div>
          {calls.length > 0 && (
            <button
              type="button"
              onClick={onViewAllCalls}
              className="text-xs font-medium text-teal-400 hover:text-teal-300 transition-colors focus-visible:outline-none focus-visible:underline"
            >
              View all ({calls.length}) →
            </button>
          )}
        </div>

        {initialLoading ? (
          <div className="p-4">
            <table className="w-full">
              <tbody>
                <TableRowSkeleton columns={6} />
                <TableRowSkeleton columns={6} />
                <TableRowSkeleton columns={6} />
              </tbody>
            </table>
          </div>
        ) : recentCalls.length === 0 ? (
          <EmptyState
            title="No recent calls"
            description="Simulate an incoming missed call to trigger your first automated AI callback session."
            actionText="Simulate missed call"
            onAction={onSimulate}
            loading={simulating}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#0c101a] text-slate-400 uppercase tracking-wider text-[11px] font-medium border-b border-slate-800/80">
                <tr>
                  <th scope="col" className="py-2.5 px-4">Time</th>
                  <th scope="col" className="py-2.5 px-4">Customer Phone</th>
                  <th scope="col" className="py-2.5 px-4">Outcome</th>
                  <th scope="col" className="py-2.5 px-4">Urgency</th>
                  <th scope="col" className="py-2.5 px-4">Reason</th>
                  <th scope="col" className="py-2.5 px-4 text-right">Latency</th>
                  <th scope="col" className="py-2.5 px-3 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recentCalls.map(c => {
                  const s = summaries[c.id];
                  const avgs = computeAverages(c.latency);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onSelectCall(c)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectCall(c);
                        }
                      }}
                      tabIndex={0}
                      className="hover:bg-slate-850/40 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-slate-850/60"
                      role="button"
                      aria-label={`View call details for ${c.customer_phone}`}
                    >
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        <RelativeTime date={c.start_time} />
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-200 whitespace-nowrap">
                        {c.customer_phone}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusBadge status={c.end_reason || 'in progress'} />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {s?.urgency ? (
                          <StatusBadge status={s.urgency} />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate text-slate-300">
                        {s?.reason || s?.short_summary || (c.end_reason ? 'No summary' : 'In progress...')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                        {avgs?.avgTotal ? `${avgs.avgTotal} ms` : '—'}
                      </td>
                      <td className="py-3 px-3 text-slate-400 text-right">
                        ›
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
