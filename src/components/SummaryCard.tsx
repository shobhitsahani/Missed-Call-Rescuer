'use client';

import { StatusBadge } from './StatusBadge';

export interface SummaryData {
  call_id?: string;
  reason?: string;
  urgency?: string;
  preferred_time?: string;
  contact_details?: string;
  suggested_action?: string;
  short_summary?: string;
  sentiment?: string;
}

interface SummaryCardProps {
  summary: SummaryData;
  title?: string;
}

export function SummaryCard({ summary, title = 'Call Summary' }: SummaryCardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 text-slate-200">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-slate-300">
            {title}
          </h3>
          {summary.urgency && (
            <StatusBadge status={summary.urgency} label={`Urgency: ${summary.urgency}`} />
          )}
        </div>
        {summary.sentiment && (
          <span className="text-xs text-slate-400 capitalize px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/50">
            Sentiment: {summary.sentiment}
          </span>
        )}
      </div>

      {summary.short_summary && (
        <div className="mt-3.5 rounded-lg bg-teal-950/20 border border-teal-800/30 p-3 text-sm text-teal-100 leading-relaxed">
          {summary.short_summary}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-slate-800/40 p-2.5 border border-slate-800/70">
          <span className="text-slate-400 font-medium block mb-1 uppercase tracking-wider text-[10px]">
            Reason
          </span>
          <p className="text-slate-200 text-sm">{summary.reason || '—'}</p>
        </div>

        <div className="rounded-lg bg-slate-800/40 p-2.5 border border-slate-800/70">
          <span className="text-slate-400 font-medium block mb-1 uppercase tracking-wider text-[10px]">
            Preferred Time
          </span>
          <p className="text-slate-200 text-sm">{summary.preferred_time || '—'}</p>
        </div>

        <div className="rounded-lg bg-slate-800/40 p-2.5 border border-slate-800/70">
          <span className="text-slate-400 font-medium block mb-1 uppercase tracking-wider text-[10px]">
            Contact Details
          </span>
          <p className="text-slate-200 text-sm">{summary.contact_details || '—'}</p>
        </div>

        <div className="rounded-lg bg-slate-800/40 p-2.5 border border-slate-800/70">
          <span className="text-slate-400 font-medium block mb-1 uppercase tracking-wider text-[10px]">
            Suggested Action
          </span>
          <p className="text-slate-200 text-sm">{summary.suggested_action || '—'}</p>
        </div>
      </div>
    </div>
  );
}
