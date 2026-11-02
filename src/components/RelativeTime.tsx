'use client';

import { useSyncExternalStore } from 'react';
import { formatRelativeTime, formatFullDateTime } from '@/lib/format';

interface RelativeTimeProps {
  date: string;
  className?: string;
}

export function RelativeTime({ date, className = '' }: RelativeTimeProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!date) return <span className={className}>—</span>;
  const full = formatFullDateTime(date);

  return (
    <time
      dateTime={date}
      title={full}
      className={`tabular-nums ${className}`}
    >
      {mounted ? formatRelativeTime(date) : full.split(',')[0]}
    </time>
  );
}
