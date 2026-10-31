'use client';

import * as React from 'react';
import { StatusBadge } from './StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Calendar, User, Lightbulb, HeartHandshake, Sparkles } from 'lucide-react';

export interface SummaryData {
  call_id?: string;
  reason?: string;
  urgency?: string;
  preferred_time?: string;
  callback_time?: string | null;
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
    <Card className="text-foreground">
      <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <CardTitle className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
            {title}
          </CardTitle>
          {summary.urgency && (
            <StatusBadge status={summary.urgency} label={`Urgency: ${summary.urgency}`} />
          )}
        </div>
        {summary.sentiment && (
          <Badge variant="outline" className="text-xs capitalize font-normal">
            Sentiment: {summary.sentiment}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {summary.short_summary && (
          <div className="rounded-lg bg-primary/10 border border-primary/20 p-3.5 text-xs text-foreground leading-relaxed">
            <p className="font-semibold text-primary mb-1 text-[11px] uppercase tracking-wider">Overview</p>
            {summary.short_summary}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
              <MessageSquare className="h-3 w-3 text-primary/70" />
              <span>Reason</span>
            </div>
            <p className="text-foreground text-xs leading-normal font-normal">
              {summary.reason || '—'}
            </p>
          </div>

          <div className="rounded-lg bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
              <Calendar className="h-3 w-3 text-primary/70" />
              <span>Preferred / Callback Time</span>
            </div>
            <p className="text-foreground text-xs leading-normal font-normal">
              {summary.callback_time || summary.preferred_time || '—'}
            </p>
          </div>

          <div className="rounded-lg bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
              <User className="h-3 w-3 text-primary/70" />
              <span>Contact Details</span>
            </div>
            <p className="text-foreground text-xs leading-normal font-mono">
              {summary.contact_details || '—'}
            </p>
          </div>

          <div className="rounded-lg bg-muted/40 border border-border p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
              <Lightbulb className="h-3 w-3 text-primary/70" />
              <span>Suggested Action</span>
            </div>
            <p className="text-foreground text-xs leading-normal font-normal">
              {summary.suggested_action || '—'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
