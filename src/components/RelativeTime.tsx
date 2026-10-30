'use client';

import { useState, useEffect } from 'react';
import { formatRelativeTime, formatFullDateTime } from '@/lib/format';

interface RelativeTimeProps {
  date: string;
  className?: string;
}

export function RelativeTime({ date, className = '' }: RelativeTimeProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
