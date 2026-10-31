'use client';

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusBadge } from './StatusBadge';
import { TranscriptBubble } from './TranscriptBubble';
import { RelativeTime } from './RelativeTime';
import { API_BASE } from '@/lib/api';
import {
  formatPlainTextTranscript,
  formatJsonTranscript,
  getTranscriptFilename,
} from '@/lib/transcript';
import {
  Copy,
  Check,
  Download,
  Send,
  Phone,
  Clock,
  Activity,
  AlertCircle,
  CheckCircle2,
  Calendar,
  User,
  HeartHandshake,
  Lightbulb,
  FileText,
  Loader2,
  Sparkles,
  MessageSquare,
} from 'lucide-react';

export type LatencyItem =
  | number
  | {
      totalMs: number;
      llmFirstTokenMs?: number | null;
      ttsFirstAudioMs?: number | null;
      turnDetectionMs?: number | null;
    };

export interface CallDetails {
  id: string;
  customer_phone: string;
  start_time: string;
  end_time: string | null;
  end_reason: string | null;
  outcome?: string | null;
  latency: LatencyItem[];
  usage?: any;
  notified_at?: string | null;
  notify_status?: string | null;
  notify_provider?: string | null;
  notify_error?: string | null;
}

export interface SummaryDetails {
  call_id: string;
  reason: string;
  urgency: string;
  preferred_time: string;
  callback_time?: string | null;
  contact_details: string;
  suggested_action: string;
  short_summary: string;
  sentiment: string;
}

export interface TurnDetails {
  id: string;
  call_id: string;
  order_idx: number;
  role: string;
  text: string;
  interrupted: number;
  ts: string;
}

function formatNotifiedTime(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

function formatProviderLabel(provider?: string | null): string {
  if (!provider) return 'Owner';
  const p = provider.toLowerCase();
  if (p === 'telegram') return 'Telegram';
  if (p === 'discord') return 'Discord';
  return provider;
}

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  call: CallDetails | null;
  businessName?: string;
  summary: SummaryDetails | null;
  turns: TurnDetails[] | null;
  loadingTurns: boolean;
}

export function Drawer({
  isOpen,
  onClose,
  call,
  businessName,
  summary,
  turns,
  loadingTurns,
}: DrawerProps) {
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [resending, setResending] = useState(false);
  const [resendStatusMsg, setResendStatusMsg] = useState<string | null>(null);
  const [resendIsError, setResendIsError] = useState(false);
  const [localNotify, setLocalNotify] = useState<{
    notified_at?: string | null;
    notify_status?: string | null;
    notify_provider?: string | null;
    notify_error?: string | null;
  }>({});

  useEffect(() => {
    setResending(false);
    setResendStatusMsg(null);
    setResendIsError(false);
    if (call) {
      setLocalNotify({
        notified_at: call.notified_at,
        notify_status: call.notify_status,
        notify_provider: call.notify_provider,
        notify_error: call.notify_error,
      });
    }
  }, [call?.id, call?.notified_at, call?.notify_status, call?.notify_error, call?.notify_provider]);

  useEffect(() => {
    setCopied(false);
    setCopiedId(false);
    setCopyError(null);
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, [call?.id, isOpen]);

  const handleResend = async () => {
    if (!call) return;
    setResending(true);
    setResendStatusMsg(null);
    setResendIsError(false);

    try {
      const res = await fetch(`${API_BASE}/api/calls/${call.id}/notify`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResendIsError(true);
        setResendStatusMsg(data?.error || `Resend failed (HTTP ${res.status})`);
      } else {
        setResendIsError(false);
        setResendStatusMsg('Notification sent');
        setLocalNotify({
          notified_at: data.notified_at || new Date().toISOString(),
          notify_status: 'sent',
          notify_provider: data.provider,
          notify_error: null,
        });
      }
    } catch (err: any) {
      setResendIsError(true);
      setResendStatusMsg(err?.message || 'Network error');
    } finally {
      setResending(false);
    }
  };

  const handleCopyId = async () => {
    if (!call) return;
    try {
      await navigator.clipboard.writeText(call.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    } catch {}
  };

  const hasTurns = Boolean(turns && turns.length > 0);

  const handleCopy = async () => {
    if (!call || !hasTurns) return;
    try {
      const text = formatPlainTextTranscript({
        call,
        businessName,
        turns,
        summary,
      });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setCopyError(null);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopyError('Failed to copy');
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopyError(null);
      }, 2500);
    }
  };

  const handleDownloadTxt = () => {
    if (!call || !hasTurns) return;
    const text = formatPlainTextTranscript({
      call,
      businessName,
      turns,
      summary,
    });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = getTranscriptFilename(call, 'txt');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    if (!call || !hasTurns) return;
    const jsonStr = formatJsonTranscript({
      call,
      businessName,
      turns,
      summary,
    });
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = getTranscriptFilename(call, 'json');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!call) return null;

  // Compute latency stats
  const totals: number[] = [];
  const llms: number[] = [];
  const ttss: number[] = [];
  for (const item of call.latency || []) {
    if (typeof item === 'number') {
      totals.push(item);
    } else if (item && typeof item === 'object') {
      if (typeof item.totalMs === 'number') totals.push(item.totalMs);
      if (typeof item.llmFirstTokenMs === 'number') llms.push(item.llmFirstTokenMs);
      if (typeof item.ttsFirstAudioMs === 'number') ttss.push(item.ttsFirstAudioMs);
    }
  }

  const avgTotal = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null;
  const avgLlm = llms.length ? Math.round(llms.reduce((a, b) => a + b, 0) / llms.length) : null;
  const avgTts = ttss.length ? Math.round(ttss.reduce((a, b) => a + b, 0) / ttss.length) : null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col h-full bg-card border-l border-border w-full sm:max-w-xl md:max-w-2xl overflow-hidden focus:outline-none"
      >
        {/* Header */}
        <SheetHeader className="p-5 pb-4 border-b border-border bg-card/60 text-left">
          <div className="flex items-start justify-between gap-4 pr-6">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
                  <Phone className="h-4 w-4" />
                </div>
                <SheetTitle className="text-lg font-semibold tracking-tight text-foreground font-mono">
                  {call.customer_phone}
                </SheetTitle>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pt-0.5">
                <div className="flex items-center gap-1 font-sans">
                  <Clock className="h-3 w-3 text-muted-foreground/70" />
                  <RelativeTime date={call.start_time} />
                </div>
                <span>·</span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  title="Click to copy call ID"
                  className="inline-flex items-center gap-1 font-mono text-[11px] hover:text-foreground text-muted-foreground transition-colors group cursor-pointer"
                >
                  <span className="truncate max-w-[120px]">{call.id}</span>
                  {copiedId ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <StatusBadge status={call.end_reason || 'in progress'} />
                {summary?.urgency && (
                  <StatusBadge status={summary.urgency} label={`Urgency: ${summary.urgency}`} />
                )}
                {call.outcome && (
                  <Badge variant="outline" className="text-[11px] capitalize font-mono">
                    {call.outcome.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <SheetDescription className="sr-only">
            Call inspection drawer with AI summary and conversation transcript.
          </SheetDescription>
        </SheetHeader>

        {/* Latency Chips Bar */}
        <div className="px-5 py-2.5 bg-muted/40 border-b border-border flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Activity className="h-3 w-3 text-primary" /> Latency:
          </span>
          <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-card text-foreground border border-border shadow-xs text-xs tabular-nums">
            Total:
            <span className="font-semibold text-primary ml-1">
              {avgTotal ? `${avgTotal} ms` : '—'}
            </span>
          </div>
          {avgLlm !== null && (
            <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60 text-xs tabular-nums">
              LLM: <span className="ml-1 font-medium text-foreground">{avgLlm} ms</span>
            </div>
          )}
          {avgTts !== null && (
            <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60 text-xs tabular-nums">
              TTS: <span className="ml-1 font-medium text-foreground">{avgTts} ms</span>
            </div>
          )}
        </div>

        {/* Scrollable Body */}
        <ScrollArea className="flex-1 p-5 space-y-6">
          <div className="space-y-6 pb-6">
            {/* Owner Notification Status Banner */}
            <div className="rounded-lg bg-card border border-border p-3.5 flex items-center justify-between gap-3 text-xs shadow-xs">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                    localNotify.notify_status === 'sent'
                      ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                      : localNotify.notify_status === 'failed'
                      ? 'bg-rose-500 ring-2 ring-rose-500/20'
                      : 'bg-muted-foreground/40'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-foreground font-medium truncate">
                    {localNotify.notify_status === 'sent'
                      ? `Owner notified via ${formatProviderLabel(localNotify.notify_provider)} at ${formatNotifiedTime(localNotify.notified_at)}`
                      : localNotify.notify_status === 'failed'
                      ? 'Owner notification failed'
                      : 'Owner notification pending'}
                  </p>
                  {localNotify.notify_status === 'failed' && localNotify.notify_error && !resendStatusMsg && (
                    <p className="text-[11px] text-destructive truncate mt-0.5">
                      {localNotify.notify_error}
                    </p>
                  )}
                  {resendStatusMsg && (
                    <p className={`text-[11px] truncate mt-0.5 font-medium ${resendIsError ? 'text-destructive' : 'text-primary'}`}>
                      {resendStatusMsg}
                    </p>
                  )}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={handleResend}
                disabled={resending}
                className="shrink-0 h-7 text-xs gap-1.5"
              >
                {resending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-3 w-3" />
                    Resend
                  </>
                )}
              </Button>
            </div>

            {/* Call Summary Section */}
            <section aria-labelledby="summary-heading" className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <h3 id="summary-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Structured AI Summary
                </h3>
              </div>

              {summary ? (
                <div className="space-y-3">
                  {summary.short_summary && (
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3.5 text-xs text-foreground leading-relaxed">
                      <p className="font-medium text-primary mb-1 text-[11px] uppercase tracking-wider">Overview</p>
                      {summary.short_summary}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    <div className="rounded-lg bg-muted/40 border border-border p-3">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
                        <MessageSquare className="h-3 w-3 text-primary/70" />
                        <span>Reason</span>
                      </div>
                      <p className="text-foreground leading-normal font-normal">
                        {summary.reason || '—'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-muted/40 border border-border p-3">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
                        <Calendar className="h-3 w-3 text-primary/70" />
                        <span>Preferred / Callback Time</span>
                      </div>
                      <p className="text-foreground leading-normal font-normal">
                        {summary.callback_time || summary.preferred_time || '—'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-muted/40 border border-border p-3">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
                        <User className="h-3 w-3 text-primary/70" />
                        <span>Contact Details</span>
                      </div>
                      <p className="text-foreground leading-normal font-mono text-[11px]">
                        {summary.contact_details || '—'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-muted/40 border border-border p-3">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
                        <Lightbulb className="h-3 w-3 text-primary/70" />
                        <span>Suggested Action</span>
                      </div>
                      <p className="text-foreground leading-normal font-normal">
                        {summary.suggested_action || '—'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-muted/40 border border-border p-3 sm:col-span-2">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider mb-1">
                        <HeartHandshake className="h-3 w-3 text-primary/70" />
                        <span>Customer Sentiment</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs capitalize font-normal">
                          {summary.sentiment || 'Neutral'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-muted/30 border border-border p-4 text-xs text-muted-foreground text-center">
                  {call.end_reason
                    ? 'No summary recorded for this call.'
                    : 'Call is in progress. Summary will appear as soon as the call finishes.'}
                </div>
              )}
            </section>

            <Separator />

            {/* Conversation Transcript Section */}
            <section aria-labelledby="transcript-heading" className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  <h3 id="transcript-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Conversation Transcript {turns && turns.length > 0 && `(${turns.length} turns)`}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    disabled={!hasTurns}
                    className="h-7 text-xs gap-1"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        Copied
                      </>
                    ) : copyError ? (
                      <>
                        <AlertCircle className="h-3 w-3 text-destructive" />
                        {copyError}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadTxt}
                    disabled={!hasTurns}
                    className="h-7 text-xs gap-1"
                  >
                    <Download className="h-3 w-3" />
                    .txt
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadJson}
                    disabled={!hasTurns}
                    className="h-7 text-xs gap-1"
                  >
                    <Download className="h-3 w-3" />
                    .json
                  </Button>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Contains verified customer audio transcript. Share with care.
              </p>

              {loadingTurns ? (
                <div className="flex items-center justify-center py-10 text-xs text-muted-foreground gap-2 rounded-xl border border-border bg-muted/20">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Loading conversation turns...
                </div>
              ) : turns && turns.length > 0 ? (
                <div className="rounded-xl border border-border bg-muted/15 p-4 max-h-[380px] overflow-y-auto space-y-2">
                  {turns.map((t) => (
                    <TranscriptBubble
                      key={t.id}
                      role={t.role}
                      text={t.text}
                      interrupted={t.interrupted === 1}
                      timestamp={t.ts}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-muted/15 p-8 text-center text-xs text-muted-foreground">
                  No transcript turns recorded for this call.
                </div>
              )}
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
