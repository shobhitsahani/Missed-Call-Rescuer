'use client';

import { useState, useMemo } from 'react';
import { CallDetails, SummaryDetails } from './Drawer';
import { computeAverages } from '@/lib/useDashboardData';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';
import { TableRowSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

interface CallsViewProps {
  calls: CallDetails[];
  summaries: Record<string, SummaryDetails>;
  initialLoading: boolean;
  onSelectCall: (call: CallDetails) => void;
  onSimulate: () => void;
  simulating: boolean;
}

const ITEMS_PER_PAGE = 15;

export function CallsView({
  calls,
  summaries,
  initialLoading,
  onSelectCall,
  onSimulate,
  simulating,
}: CallsViewProps) {
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Client-side filtering
  const filteredCalls = useMemo(() => {
    return calls.filter(call => {
      const s = summaries[call.id];
      const outcome = (call.end_reason || 'in progress').toLowerCase();
      const urgency = (s?.urgency || '').toLowerCase();

      // Search match
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        const phoneMatch = (call.customer_phone || '').toLowerCase().includes(query);
        const reasonMatch = (s?.reason || '').toLowerCase().includes(query);
        const summaryMatch = (s?.short_summary || '').toLowerCase().includes(query);
        const idMatch = (call.id || '').toLowerCase().includes(query);
        if (!phoneMatch && !reasonMatch && !summaryMatch && !idMatch) {
          return false;
        }
      }

      // Outcome match
      if (outcomeFilter !== 'all') {
        if (outcomeFilter === 'in_progress') {
          if (outcome !== 'in progress' && outcome !== 'in_progress') return false;
        } else if (!outcome.includes(outcomeFilter.toLowerCase())) {
          return false;
        }
      }

      // Urgency match
      if (urgencyFilter !== 'all') {
        if (urgency !== urgencyFilter.toLowerCase()) return false;
      }

      return true;
    });
  }, [calls, summaries, search, outcomeFilter, urgencyFilter]);

  // Reset page when filter changes
  const totalPages = Math.max(1, Math.ceil(filteredCalls.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  const paginatedCalls = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredCalls.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredCalls, currentPage]);

  const startIndex = filteredCalls.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIndex = Math.min(filteredCalls.length, currentPage * ITEMS_PER_PAGE);

  return (
    <div className="space-y-4">
      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#0e131f] border border-slate-800/80 p-3 rounded-xl">
        <div className="flex-1 flex flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by phone, reason..."
              className="w-full pl-8 pr-3 py-1.5 bg-[#090d16] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:border-transparent transition-colors"
            />
          </div>

          {/* Outcome Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <label htmlFor="outcome-select" className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
              Outcome:
            </label>
            <select
              id="outcome-select"
              value={outcomeFilter}
              onChange={e => {
                setOutcomeFilter(e.target.value);
                setPage(1);
              }}
              className="bg-[#090d16] border border-slate-800 rounded-lg text-xs text-slate-200 px-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
            >
              <option value="all">All Outcomes</option>
              <option value="completed">Completed</option>
              <option value="opted_out">Opted Out</option>
              <option value="wrong_number">Wrong Number</option>
              <option value="user_ended">User Ended</option>
              <option value="in_progress">In Progress</option>
            </select>
          </div>

          {/* Urgency Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <label htmlFor="urgency-select" className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
              Urgency:
            </label>
            <select
              id="urgency-select"
              value={urgencyFilter}
              onChange={e => {
                setUrgencyFilter(e.target.value);
                setPage(1);
              }}
              className="bg-[#090d16] border border-slate-800 rounded-lg text-xs text-slate-200 px-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
            >
              <option value="all">All Urgencies</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        {/* Counter */}
        <div className="text-xs text-slate-400 whitespace-nowrap self-end sm:self-auto">
          {filteredCalls.length} {filteredCalls.length === 1 ? 'call' : 'calls'}
        </div>
      </div>

      {/* Calls Table Container */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0e131f] overflow-hidden">
        {initialLoading ? (
          <div className="p-4">
            <table className="w-full">
              <tbody>
                <TableRowSkeleton columns={7} />
                <TableRowSkeleton columns={7} />
                <TableRowSkeleton columns={7} />
                <TableRowSkeleton columns={7} />
              </tbody>
            </table>
          </div>
        ) : filteredCalls.length === 0 ? (
          <EmptyState
            title="No calls found"
            description={
              search || outcomeFilter !== 'all' || urgencyFilter !== 'all'
                ? 'Try adjusting your search query or filters.'
                : 'No calls recorded yet. Trigger a simulated call to create your first session.'
            }
            actionText="Simulate missed call"
            onAction={onSimulate}
            loading={simulating}
          />
        ) : (
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#0c101a] text-slate-400 uppercase tracking-wider text-[11px] font-medium border-b border-slate-800/80 z-10 shadow-xs">
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
                {paginatedCalls.map(c => {
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
                      <td className="py-2.5 px-4 text-slate-400 whitespace-nowrap">
                        <RelativeTime date={c.start_time} />
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-200 whitespace-nowrap">
                        {c.customer_phone}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <StatusBadge status={c.end_reason || 'in progress'} />
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {s?.urgency ? (
                          <StatusBadge status={s.urgency} />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 max-w-xs truncate text-slate-300">
                        {s?.reason || s?.short_summary || (c.end_reason ? 'No summary' : 'In progress...')}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-300 tabular-nums whitespace-nowrap">
                        {avgs?.avgTotal ? `${avgs.avgTotal} ms` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 text-right">
                        ›
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {filteredCalls.length > 0 && (
          <div className="px-4 py-3 bg-[#0c101a] border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>
              Showing <strong className="text-slate-200">{startIndex}</strong> to{' '}
              <strong className="text-slate-200">{endIndex}</strong> of{' '}
              <strong className="text-slate-200">{filteredCalls.length}</strong> calls
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="px-2.5 py-1 rounded bg-[#090d16] border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
              >
                Previous
              </button>
              <span className="text-slate-400 tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-2.5 py-1 rounded bg-[#090d16] border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
