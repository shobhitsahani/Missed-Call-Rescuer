'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

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
  | 'lead'
  | 'booking_request'
  | 'complaint'
  | 'question'
  | 'spam'
  | 'other'
  | string;

interface StatusBadgeProps {
  status: BadgeType;
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({ status, label, size = 'sm', className }: StatusBadgeProps) {
  const norm = (status || '').toLowerCase().trim();
  const displayText = label || norm.replace(/_/g, ' ');

  let colorClasses =
    'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/20';
  let dotColor = 'bg-slate-400';
  let pulse = false;

  switch (norm) {
    case 'done':
    case 'completed':
    case 'lead':
      colorClasses =
        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25';
      dotColor = 'bg-emerald-500 dark:bg-emerald-400';
      break;

    case 'calling':
    case 'in progress':
    case 'in_progress':
      colorClasses =
        'bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/25';
      dotColor = 'bg-teal-500 dark:bg-teal-400';
      pulse = true;
      break;

    case 'opted_out':
    case 'opted out':
    case 'queued':
    case 'medium':
    case 'wrong_number':
    case 'question':
      colorClasses =
        'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25';
      dotColor = 'bg-amber-500 dark:bg-amber-400';
      break;

    case 'booking_request':
      colorClasses =
        'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/25';
      dotColor = 'bg-indigo-500 dark:bg-indigo-400';
      break;

    case 'new':
      colorClasses =
        'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/25';
      dotColor = 'bg-cyan-500 dark:bg-cyan-400';
      break;

    case 'high':
    case 'failed':
    case 'error':
    case 'complaint':
    case 'spam':
      colorClasses =
        'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/25';
      dotColor = 'bg-rose-500 dark:bg-rose-400';
      break;

    case 'low':
    case 'no answer':
    case 'no_answer':
    case 'user_ended':
    case 'disconnect':
    case 'other':
    default:
      colorClasses =
        'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/20';
      dotColor = 'bg-slate-400';
      break;
  }

  const sizeClasses =
    size === 'sm'
      ? 'text-[11px] px-2.5 py-0.5 font-medium tracking-tight'
      : 'text-xs px-3 py-1 font-medium';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border whitespace-nowrap transition-colors',
        sizeClasses,
        colorClasses,
        className
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full shrink-0',
          dotColor,
          pulse && 'animate-pulse'
        )}
        aria-hidden="true"
      />
      <span className="capitalize">{displayText}</span>
    </span>
  );
}
