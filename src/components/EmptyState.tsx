'use client';

import * as React from 'react';
import { PhoneCall, Loader2, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
  loading?: boolean;
}

export function EmptyState({
  title,
  description,
  actionText = 'Simulate missed call',
  onAction,
  loading = false,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="h-10 w-10 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground mb-3">
        <Inbox className="w-5 h-5" />
      </div>

      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground max-w-sm">{description}</p>

      {onAction && (
        <div className="mt-4">
          <Button
            size="sm"
            onClick={onAction}
            disabled={loading}
            className="text-xs font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Simulating...</span>
              </>
            ) : (
              <>
                <PhoneCall className="h-3.5 w-3.5" />
                <span>{actionText}</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
