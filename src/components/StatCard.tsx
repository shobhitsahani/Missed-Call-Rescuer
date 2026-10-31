'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  tooltip?: string;
  icon?: LucideIcon;
}

export function StatCard({ title, value, subtitle, tooltip, icon: Icon }: StatCardProps) {
  const isAvailable = value !== null && value !== undefined && value !== '' && value !== '—';

  return (
    <Card
      className="relative overflow-hidden transition-all duration-200 hover:border-border/80 hover:shadow-xs group"
      title={tooltip}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground tracking-tight truncate">
            {title}
          </p>
          {Icon && (
            <div className="h-7 w-7 rounded-md bg-muted/60 flex items-center justify-center shrink-0 text-muted-foreground group-hover:text-primary transition-colors">
              <Icon className="h-3.5 w-3.5" />
            </div>
          )}
        </div>

        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums font-mono">
            {isAvailable ? value : '—'}
          </span>
        </div>

        {subtitle && (
          <p className="mt-1.5 text-xs text-muted-foreground leading-normal truncate tabular-nums">
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
