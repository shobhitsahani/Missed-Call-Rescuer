'use client';

type BadgeType =
  | 'new'
  | 'queued'
  | 'calling'
  | 'done'
  | 'opted_out'
  | 'opted out'
  | 'failed'
  | 'low'
  | 'medium'
  | 'high'
  | 'completed'
  | 'user_ended'
  | 'no_answer'
  | 'no answer'
  | 'wrong_number'
  | 'in progress'
  | 'in_progress'
  | 'error'
  | 'disconnect'
  | string;

interface StatusBadgeProps {
  status: BadgeType;
  label?: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, label, size = 'sm' }: StatusBadgeProps) {
  const norm = (status || '').toLowerCase().trim();
  const displayText = label || norm.replace(/_/g, ' ');

  let colorClasses = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  let dotColor = 'bg-slate-400';
  let pulse = false;

  switch (norm) {
    case 'done':
    case 'completed':
      colorClasses = 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
      dotColor = 'bg-emerald-400';
      break;

    case 'calling':
    case 'in progress':
    case 'in_progress':
      colorClasses = 'bg-teal-500/10 text-teal-300 border-teal-500/25';
      dotColor = 'bg-teal-400';
      pulse = true;
      break;

    case 'opted_out':
    case 'opted out':
    case 'queued':
    case 'medium':
    case 'wrong_number':
      colorClasses = 'bg-amber-500/10 text-amber-300 border-amber-500/20';
      dotColor = 'bg-amber-400';
      break;

    case 'new':
      colorClasses = 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20';
      dotColor = 'bg-cyan-400';
      break;

    case 'high':
    case 'failed':
    case 'error':
      colorClasses = 'bg-rose-500/10 text-rose-300 border-rose-500/20';
      dotColor = 'bg-rose-400';
      break;

    case 'low':
    case 'no answer':
    case 'no_answer':
    case 'user_ended':
    case 'disconnect':
      colorClasses = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      dotColor = 'bg-slate-400';
      break;
  }

  const sizeClasses =
    size === 'sm'
      ? 'text-[11px] px-2 py-0.5 font-medium tracking-tight'
      : 'text-xs px-2.5 py-1 font-medium';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${sizeClasses} ${colorClasses} whitespace-nowrap`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${dotColor} ${
          pulse ? 'animate-pulse' : ''
        }`}
        aria-hidden="true"
      />
      <span className="capitalize">{displayText}</span>
    </span>
  );
}
