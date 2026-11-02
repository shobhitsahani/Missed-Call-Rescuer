export interface TranscriptCall {
  id: string;
  customer_phone?: string;
  start_time?: string;
  end_time?: string | null;
  end_reason?: string | null;
  latency?: unknown;
  usage?: unknown;
}

export interface TranscriptSummary {
  call_id?: string;
  reason?: string;
  urgency?: string;
  preferred_time?: string;
  contact_details?: string;
  suggested_action?: string;
  short_summary?: string;
  sentiment?: string;
}

export interface TranscriptTurn {
  id?: string;
  call_id?: string;
  order_idx?: number;
  role: string;
  text: string;
  interrupted?: number | boolean;
  ts?: string;
}

export interface TranscriptData {
  call: TranscriptCall;
  businessName?: string;
  turns: TranscriptTurn[] | null;
  summary: TranscriptSummary | null;
}

export function formatDuration(startTime?: string | null, endTime?: string | null): string {
  if (!startTime) return 'unknown';
  if (!endTime) return 'In progress';
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return 'unknown';
  const totalSec = Math.round((end - start) / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function getTranscriptFilename(
  call: { id: string; customer_phone?: string; start_time?: string },
  format: 'txt' | 'json'
): string {
  const digits = (call.customer_phone || '').replace(/\D/g, '');
  const identifier = digits.length >= 4 ? digits : (call.id || 'call');

  const d = call.start_time ? new Date(call.start_time) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = validDate.getFullYear();
  const m = pad(validDate.getMonth() + 1);
  const day = pad(validDate.getDate());
  const h = pad(validDate.getHours());
  const min = pad(validDate.getMinutes());
  const dateStr = `${y}${m}${day}-${h}${min}`;

  return `transcript-${identifier}-${dateStr}.${format}`;
}

export function formatPlainTextTranscript(data: TranscriptData): string {
  const { call, businessName, turns = [], summary } = data;
  const lines: string[] = [];

  // Header lines
  lines.push(`Business: ${businessName || 'Unknown Business'}`);
  lines.push(`Customer Phone: ${call.customer_phone || 'unknown'}`);
  lines.push(`Call Start: ${call.start_time || 'unknown'}`);
  lines.push(`Call Duration: ${formatDuration(call.start_time, call.end_time)}`);
  lines.push(`End Reason: ${call.end_reason || 'in progress'}`);

  if (turns && turns.length > 0) {
    lines.push(''); // blank line before turns

    const validFirstTurn = turns.find(t => t.ts && !isNaN(new Date(t.ts).getTime()));
    const firstTurnTs = validFirstTurn && validFirstTurn.ts ? new Date(validFirstTurn.ts).getTime() : null;

    turns.forEach((turn, idx) => {
      let timeTag = `[Turn ${turn.order_idx ?? idx + 1}]`;
      if (turn.ts && firstTurnTs !== null) {
        const turnTime = new Date(turn.ts).getTime();
        if (!isNaN(turnTime)) {
          const diffSec = Math.max(0, Math.floor((turnTime - firstTurnTs) / 1000));
          const mm = String(Math.floor(diffSec / 60)).padStart(2, '0');
          const ss = String(diffSec % 60).padStart(2, '0');
          timeTag = `[${mm}:${ss}]`;
        }
      }

      const roleStr = (turn.role || '').toLowerCase();
      const roleLabel = roleStr === 'agent' || roleStr === 'assistant' ? 'Agent' : 'Customer';
      const isInterrupted = Boolean(turn.interrupted) &&
        (roleStr === 'agent' || roleStr === 'assistant');

      lines.push(`${timeTag} ${roleLabel}: ${turn.text}${isInterrupted ? ' (interrupted)' : ''}`);
    });
  }

  // Summary block
  if (summary) {
    lines.push('');
    lines.push('Summary');
    lines.push(`Reason: ${summary.reason || 'not specified'}`);
    lines.push(`Urgency: ${summary.urgency || 'medium'}`);
    lines.push(`Preferred Time: ${summary.preferred_time || 'not specified'}`);
    lines.push(`Contact Details: ${summary.contact_details || 'not provided'}`);
    lines.push(`Suggested Action: ${summary.suggested_action || 'Follow up with customer'}`);
    lines.push(`Sentiment: ${summary.sentiment || 'neutral'}`);
  }

  return lines.join('\n') + '\n';
}

export function formatJsonTranscript(data: TranscriptData): string {
  const { call, businessName, turns = [], summary } = data;

  const jsonObject: Record<string, unknown> = {
    business: businessName || 'Unknown Business',
    call: {
      id: call.id,
      customerPhone: call.customer_phone || 'unknown',
      startedAt: call.start_time,
      endedAt: call.end_time || null,
      endReason: call.end_reason || null,
      duration: formatDuration(call.start_time, call.end_time),
      ...(call.latency ? { latency: call.latency } : {}),
      ...(call.usage ? { usage: call.usage } : {}),
    },
    turns: (turns || []).map((t, idx) => ({
      index: t.order_idx ?? idx + 1,
      role: (t.role || '').toLowerCase() === 'agent' || (t.role || '').toLowerCase() === 'assistant' ? 'Agent' : 'Customer',
      text: t.text,
      interrupted: Boolean(t.interrupted),
      timestamp: t.ts || null,
    })),
    summary: summary
      ? {
          reason: summary.reason || 'not specified',
          urgency: summary.urgency || 'medium',
          preferredTime: summary.preferred_time || 'not specified',
          contactDetails: summary.contact_details || 'not provided',
          suggestedAction: summary.suggested_action || 'Follow up with customer',
          shortSummary: summary.short_summary || '',
          sentiment: summary.sentiment || 'neutral',
        }
      : null,
  };

  return JSON.stringify(jsonObject, null, 2) + '\n';
}
