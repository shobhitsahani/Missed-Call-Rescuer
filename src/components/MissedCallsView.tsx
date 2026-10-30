'use client';

import { useState, useMemo } from 'react';
import { MissedCall } from '@/lib/useDashboardData';
import { StatusBadge } from './StatusBadge';
import { RelativeTime } from './RelativeTime';
import { TableRowSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

interface MissedCallsViewProps {
  missed: MissedCall[];
  initialLoading: boolean;
  onSimulate: () => void;
  simulating: boolean;
}

const ITEMS_PER_PAGE = 15;

export function MissedCallsView({
  missed,
  initialLoading,
  onSimulate,
  simulating,
}: MissedCallsViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const filteredMissed = useMemo(() => {
    return missed.filter(m => {
      const status = (m.status || '').toLowerCase();

      // Search match
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        const phoneMatch = (m.customer_phone || '').toLowerCase().includes(query);
        const idMatch = (m.id || '').toLowerCase().includes(query);
        if (!phoneMatch && !idMatch) return false;
      }

      // Status match
      if (statusFilter !== 'all') {
        if (!status.includes(statusFilter.toLowerCase())) return false;
      }

      return true;
    });
  }, [missed, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredMissed.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  const paginatedMissed = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredMissed.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredMissed, currentPage]);

  const startIndex = filteredMissed.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIndex = Math.min(filteredMissed.length, currentPage * ITEMS_PER_PAGE);

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
              placeholder="Search by phone, ID..."
              className="w-full pl-8 pr-3 py-1.5 bg-[#090d16] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:border-transparent transition-colors"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <label htmlFor="missed-status-select" className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
              Status:
            </label>
            <select
              id="missed-status-select"
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="bg-[#090d16] border border-slate-800 rounded-lg text-xs text-slate-200 px-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
            >
              <option value="all">All Statuses</option>
              <option value="new">New</option>
              <option value="queued">Queued</option>
              <option value="calling">Calling</option>
              <option value="done">Done</option>
              <option value="opted_out">Opted Out</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-slate-400 whitespace-nowrap self-end sm:self-auto">
          {filteredMissed.length} {filteredMissed.length === 1 ? 'record' : 'records'}
        </div>
      </div>

      {/* Missed Calls Table */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0e131f] overflow-hidden">
        {initialLoading ? (
          <div className="p-4">
            <table className="w-full">
              <tbody>
                <TableRowSkeleton columns={4} />
                <TableRowSkeleton columns={4} />
                <TableRowSkeleton columns={4} />
                <TableRowSkeleton columns={4} />
              </tbody>
            </table>
          </div>
        ) : filteredMissed.length === 0 ? (
          <EmptyState
            title="No missed calls found"
            description={
              search || statusFilter !== 'all'
                ? 'Try adjusting your search query or status filter.'
                : 'No missed calls logged yet. Trigger a simulated call to create an inbound missed call record.'
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
                  <th scope="col" className="py-2.5 px-4">Status</th>
                  <th scope="col" className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paginatedMissed.map(m => {
                  const isCallable = m.status === 'new' || m.status === 'queued';
                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-slate-850/40 transition-colors"
                    >
                      <td className="py-2.5 px-4 text-slate-400 whitespace-nowrap">
                        <RelativeTime date={m.time} />
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className="font-medium text-slate-200 block">
                          {m.customer_phone}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {m.id}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {isCallable ? (
                          <a
                            href={`/call/${m.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/30 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
                          >
                            <span>Open call page</span>
                            <span aria-hidden="true">↗</span>
                          </a>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {filteredMissed.length > 0 && (
          <div className="px-4 py-3 bg-[#0c101a] border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>
              Showing <strong className="text-slate-200">{startIndex}</strong> to{' '}
              <strong className="text-slate-200">{endIndex}</strong> of{' '}
              <strong className="text-slate-200">{filteredMissed.length}</strong> records
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
