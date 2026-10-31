'use client';

import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { TranscriptBubble } from './TranscriptBubble';
import { RelativeTime } from './RelativeTime';
import { API_BASE } from '@/lib/api';
import {
  formatPlainTextTranscript,
  formatJsonTranscript,
  getTranscriptFilename,
} from '@/lib/transcript';

export type LatencyItem =
  | number
  | { totalMs: number; llmFirstTokenMs?: number | null; ttsFirstAudioMs?: number | null };

export interface CallDetails {
  id: string;
  customer_phone: string;
  start_time: string;
  end_time: string | null;
  end_reason: string | null;
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
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [copied, setCopied] = useState(false);
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

  // Clear copy state on call change or close
  useEffect(() => {
    setCopied(false);
    setCopyError(null);
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, [call?.id, isOpen]);

  // Handle ESC key and focus management
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Focus close button on open
    setTimeout(() => closeButtonRef.current?.focus(), 50);

    // Prevent body scroll when drawer is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || !call) return null;

  // Compute latency stats for chips
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

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-6 pointer-events-none">
        <div className="w-screen max-w-lg pointer-events-auto bg-[#0d121e] border-l border-slate-800/90 shadow-2xl flex flex-col transform transition-transform duration-200 ease-in-out">
          {/* Header */}
          <div className="p-5 border-b border-slate-800 bg-[#0e1422] flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id="drawer-title"
                className="text-lg font-semibold text-white tracking-tight"
              >
                {call.customer_phone}
              </h2>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                <RelativeTime date={call.start_time} />
                <span>·</span>
                <span className="font-mono text-slate-400 truncate max-w-[140px]">
                  {call.id}
                </span>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <StatusBadge status={call.end_reason || 'in progress'} />
                {summary?.urgency && (
                  <StatusBadge status={summary.urgency} label={`Urgency: ${summary.urgency}`} />
                )}
              </div>
            </div>

            {/* Close Button */}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              aria-label="Close call details drawer"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Latency chips bar */}
          <div className="px-5 py-2.5 bg-slate-900/40 border-b border-slate-800/60 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 text-[11px] uppercase tracking-wider font-medium">
              Latency:
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700/60 tabular-nums">
              Total: <span className="font-semibold text-teal-300 ml-1">{avgTotal ? `${avgTotal} ms` : '—'}</span>
            </span>
            {avgLlm !== null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/40 tabular-nums">
                LLM: {avgLlm} ms
              </span>
            )}
            {avgTts !== null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/40 tabular-nums">
                TTS: {avgTts} ms
              </span>
            )}
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Owner Notification Status Banner */}
            <div className="rounded-lg bg-slate-900/60 border border-slate-800/80 p-3 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    localNotify.notify_status === 'sent'
                      ? 'bg-teal-400'
                      : localNotify.notify_status === 'failed'
                      ? 'bg-rose-400'
                      : 'bg-slate-500'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-slate-200 font-medium truncate">
                    {localNotify.notify_status === 'sent'
                      ? `Owner notified via ${formatProviderLabel(localNotify.notify_provider)} at ${formatNotifiedTime(localNotify.notified_at)}`
                      : localNotify.notify_status === 'failed'
                      ? 'Notification failed'
                      : 'Owner not notified'}
                  </p>
                  {localNotify.notify_status === 'failed' && localNotify.notify_error && !resendStatusMsg && (
                    <p className="text-[11px] text-rose-300/80 truncate mt-0.5">
                      {localNotify.notify_error}
                    </p>
                  )}
                  {resendStatusMsg && (
                    <p className={`text-[11px] truncate mt-0.5 ${resendIsError ? 'text-rose-300' : 'text-teal-300'}`}>
                      {resendStatusMsg}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="shrink-0 px-2.5 py-1 text-xs font-medium rounded border border-slate-700/80 bg-slate-800/80 hover:bg-slate-700 text-slate-200 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                {resending ? 'Sending...' : 'Resend'}
              </button>
            </div>

            {/* Structured Summary Section */}
            <section aria-labelledby="summary-section-heading">
              <h3
                id="summary-section-heading"
                className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3"
              >
                Call Summary
              </h3>

              {summary ? (
                <div className="space-y-3.5">
                  {summary.short_summary && (
                    <div className="rounded-lg bg-teal-950/20 border border-teal-800/30 p-3 text-xs text-teal-100 leading-relaxed">
                      {summary.short_summary}
                    </div>
                  )}

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg bg-slate-900/60 border border-slate-800/70 p-3">
                      <dt className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                        Reason
                      </dt>
                      <dd className="mt-1 text-slate-200 text-xs leading-normal">
                        {summary.reason || '—'}
                      </dd>
                    </div>

                    <div className="rounded-lg bg-slate-900/60 border border-slate-800/70 p-3">
                      <dt className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                        Preferred Time
                      </dt>
                      <dd className="mt-1 text-slate-200 text-xs leading-normal">
                        {summary.preferred_time || '—'}
                      </dd>
                    </div>

                    <div className="rounded-lg bg-slate-900/60 border border-slate-800/70 p-3">
                      <dt className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                        Contact Details
                      </dt>
                      <dd className="mt-1 text-slate-200 text-xs leading-normal">
                        {summary.contact_details || '—'}
                      </dd>
                    </div>

                    <div className="rounded-lg bg-slate-900/60 border border-slate-800/70 p-3">
                      <dt className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                        Suggested Action
                      </dt>
                      <dd className="mt-1 text-slate-200 text-xs leading-normal">
                        {summary.suggested_action || '—'}
                      </dd>
                    </div>

                    <div className="rounded-lg bg-slate-900/60 border border-slate-800/70 p-3 sm:col-span-2">
                      <dt className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                        Customer Sentiment
                      </dt>
                      <dd className="mt-1 text-slate-200 text-xs capitalize leading-normal">
                        {summary.sentiment || '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-900/40 border border-slate-800/60 p-4 text-xs text-slate-400">
                  {call.end_reason ? 'No summary generated for this call.' : 'Call is in progress. Summary will appear once completed.'}
                </div>
              )}
            </section>

            {/* Transcript Section */}
            <section aria-labelledby="transcript-section-heading">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                <h3
                  id="transcript-section-heading"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Transcript
                </h3>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!hasTurns}
                    title={hasTurns ? 'Copy transcript to clipboard' : 'No turns recorded'}
                    aria-label="Copy transcript"
                    className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                      !hasTurns
                        ? 'opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500'
                        : copied
                        ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                        : copyError
                        ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border-slate-700/80 active:bg-slate-700'
                    }`}
                  >
                    {copied ? 'Copied' : copyError ? copyError : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadTxt}
                    disabled={!hasTurns}
                    title={hasTurns ? 'Download plain text transcript' : 'No turns recorded'}
                    aria-label="Download plain text transcript"
                    className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                      !hasTurns
                        ? 'opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border-slate-700/80 active:bg-slate-700'
                    }`}
                  >
                    Download .txt
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    disabled={!hasTurns}
                    title={hasTurns ? 'Download JSON transcript' : 'No turns recorded'}
                    aria-label="Download JSON transcript"
                    className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                      !hasTurns
                        ? 'opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border-slate-700/80 active:bg-slate-700'
                    }`}
                  >
                    Download .json
                  </button>
                </div>
              </div>

              {/* Muted privacy note and live announcement */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-3" aria-live="polite">
                <span>Contains customer data. Share with care.</span>
                {copied && <span className="text-teal-400 font-medium">Copied!</span>}
                {copyError && <span className="text-rose-400 font-medium">{copyError}</span>}
              </div>

              {loadingTurns ? (
                <div className="flex items-center justify-center py-8 text-xs text-slate-400 gap-2 rounded-xl border border-slate-800/70 bg-slate-950/40">
                  <span className="h-4 w-4 rounded-full border-2 border-slate-600 border-t-teal-400 animate-spin" />
                  Loading conversation turns...
                </div>
              ) : turns && turns.length > 0 ? (
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-4 max-h-96 overflow-y-auto">
                  {turns.map(t => (
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
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
                  No transcript turns recorded for this call.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
