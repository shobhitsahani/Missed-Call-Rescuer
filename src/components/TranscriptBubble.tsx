'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface TranscriptBubbleProps {
  role: 'agent' | 'customer' | string;
  text: string;
  interrupted?: boolean;
  timestamp?: string;
  className?: string;
}

export function TranscriptBubble({
  role,
  text,
  interrupted,
  timestamp,
  className,
}: TranscriptBubbleProps) {
  const isCustomer = role === 'customer';

  return (
    <div
      className={cn(
        'flex flex-col mb-3',
        isCustomer ? 'items-end' : 'items-start',
        className
      )}
    >
      <div className="flex items-center gap-2 mb-1 px-1">
        <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground font-mono">
          {isCustomer ? 'Customer' : 'Voice Agent'}
        </span>
        {timestamp && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {new Date(timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
      </div>

      <div
        className={cn(
          'max-w-[85%] sm:max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed transition-colors',
          isCustomer
            ? 'bg-primary text-primary-foreground rounded-tr-xs shadow-xs font-normal'
            : 'bg-muted/80 text-foreground border border-border rounded-tl-xs shadow-xs'
        )}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>

        {interrupted && !isCustomer && (
          <div className="mt-1.5 flex items-center gap-1">
            <Badge variant="warning" className="text-[9px] px-1.5 py-0">
              interrupted
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
