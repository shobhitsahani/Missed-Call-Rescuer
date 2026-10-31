'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { usePlatform } from '@/lib/platform';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  shortcutKey?: string;
  actionName?: string;
}

export function Kbd({
  shortcutKey = 'K',
  actionName = 'Search',
  className,
  ...props
}: KbdProps) {
  const { platform, mounted } = usePlatform();

  // On touch devices (smartphones, tablets, iPads), do not display physical keyboard shortcuts
  if (mounted && platform === 'touch') {
    return null;
  }

  // Pre-hydration / initial client placeholder: renders neutral element with identical dimensions
  // to eliminate layout shift while preventing hydration mismatch warnings
  if (!mounted) {
    return (
      <kbd
        className={cn(
          'pointer-events-none inline-flex h-4 min-w-[28px] select-none items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground opacity-60',
          className
        )}
        aria-hidden="true"
        {...props}
      >
        <span className="invisible">Ctrl K</span>
      </kbd>
    );
  }

  const isMac = platform === 'mac';
  const modifierLabel = isMac ? '⌘' : 'Ctrl';
  const accessibleLabel = `${actionName}, shortcut ${isMac ? 'Command' : 'Control'} ${shortcutKey}`;

  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-4 select-none items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[9px] font-medium text-muted-foreground shadow-xs',
        className
      )}
      aria-label={accessibleLabel}
      {...props}
    >
      <span aria-hidden="true">{modifierLabel}</span>
      <span aria-hidden="true">{shortcutKey}</span>
      <span className="sr-only">({accessibleLabel})</span>
    </kbd>
  );
}
