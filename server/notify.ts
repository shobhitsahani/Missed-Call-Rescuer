import db from './db';
import * as events from './events';

export type NotifyProvider = 'telegram' | 'discord' | 'none';

export interface NotifyPayload {
  callId: string;
  businessName: string;
  customerPhone?: string | null;
  endReason?: string | null;
  summary?: {
    reason?: string;
    urgency?: string;
    preferred_time?: string;
    contact_details?: string;
    suggested_action?: string;
    short_summary?: string;
    sentiment?: string;
  } | null;
}

/**
 * Mask middle digits of phone number for privacy.
 * Examples:
 *   +91 9876543210 -> +91 ******3210
 *   +1 (555) 010-1234 -> +1 ******1234
 *   +15550101234 -> +1 ******1234
 *   unknown -> unknown
 */
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone || phone === 'unknown') return 'unknown';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 4) return trimmed;

  const last4 = digits.slice(-4);

  // If formatted with space after country code (e.g. "+91 9876543210")
  const spaceMatch = trimmed.match(/^(\+\d{1,3})\s+/);
  if (spaceMatch) {
    return `${spaceMatch[1]} ******${last4}`;
  }

  // If starts with + (e.g. "+15550101234", "+919876543210")
  if (trimmed.startsWith('+')) {
    const countryCodeLen = Math.max(1, digits.length - 10);
    const countryCode = digits.slice(0, countryCodeLen);
    return `+${countryCode} ******${last4}`;
  }

  const prefix = digits.length > 7 ? digits.slice(0, digits.length - 7) : digits.slice(0, 2);
  return `${prefix} ******${last4}`;
}

/**
 * Sanitize error messages to ensure no tokens, webhooks, or phone numbers leak into logs or responses.
 */
export function sanitizeError(msg: string): string {
  if (!msg) return 'Unknown error';
  let sanitized = String(msg);

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (botToken) {
    sanitized = sanitized.split(botToken).join('<REDACTED_BOT_TOKEN>');
    const parts = botToken.split(':');
    if (parts.length === 2 && parts[1].length > 4) {
      sanitized = sanitized.split(parts[1]).join('<REDACTED_TOKEN_SECRET>');
    }
  }

  const discordUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (discordUrl) {
    sanitized = sanitized.split(discordUrl).join('<REDACTED_DISCORD_WEBHOOK>');
    const parts = discordUrl.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 5) {
      sanitized = sanitized.split(lastPart).join('<REDACTED_WEBHOOK_TOKEN>');
    }
  }

  // Redact Telegram bot token patterns: bot<token>
  sanitized = sanitized.replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot<REDACTED>');
  // Redact Discord webhook token paths: /webhooks/<id>/<token>
  sanitized = sanitized.replace(/\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, '/api/webhooks/<REDACTED>');
  // Redact 10+ digit phone numbers if present
  sanitized = sanitized.replace(/\+?\d{10,15}/g, (match) => maskPhoneNumber(match));

  return sanitized.trim().slice(0, 250);
}

/**
 * Helper to safely truncate field contents with an ellipsis.
 */
function truncateField(val: string | undefined | null, maxLen: number): string {
  if (!val) return '—';
  const s = val.trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

/**
 * Format call summary or end-status into a concise, scannable plain-text notification.
 * Uses plain text without parse mode to prevent markup breakage or injection.
 */
export function formatCallNotification(
  payload: NotifyPayload,
  dashboardUrl: string = process.env.DASHBOARD_URL || 'http://localhost:3010'
): string {
  const { callId, businessName, customerPhone, endReason, summary } = payload;
  const maskedPhone = maskPhoneNumber(customerPhone);
  const cleanDashboardUrl = dashboardUrl.replace(/\/+$/, '');
  const dashboardLink = `${cleanDashboardUrl}/?call=${encodeURIComponent(callId)}`;

  // Line 1: Outcome and urgency
  let line1: string;
  const urgency = summary?.urgency ? summary.urgency.trim().toUpperCase() : null;

  if (endReason === 'opted_out') {
    line1 = 'Missed-call callback: OPTED OUT';
  } else if (endReason === 'error') {
    line1 = 'Missed-call callback: ERROR';
  } else if (endReason === 'no_answer') {
    line1 = 'Missed-call callback: NO ANSWER';
  } else if (urgency) {
    line1 = `Missed-call callback: ${urgency} urgency`;
  } else {
    line1 = 'Missed-call callback: Call completed';
  }

  const lines: string[] = [
    line1,
    `${businessName || 'Business'} · Customer: ${maskedPhone}`,
    '',
  ];

  if (endReason === 'opted_out') {
    lines.push('Status: Customer opted out of callbacks and requested no further contact.');
  } else if (endReason === 'error') {
    lines.push('Status: Call ended unexpectedly due to an error.');
  } else if (endReason === 'no_answer') {
    lines.push('Status: Call was not answered by the customer.');
  } else if (summary) {
    lines.push(`Reason: ${truncateField(summary.reason, 200)}`);
    lines.push(`Preferred time: ${truncateField(summary.preferred_time, 100)}`);
    lines.push(`Contact details: ${truncateField(summary.contact_details, 100)}`);
    lines.push(`Suggested action: ${truncateField(summary.suggested_action, 200)}`);
    const sentiment = summary.sentiment
      ? summary.sentiment.charAt(0).toUpperCase() + summary.sentiment.slice(1).toLowerCase()
      : 'Neutral';
    lines.push(`Sentiment: ${sentiment}`);
  } else {
    lines.push(`Status: Completed (${endReason || 'normal'})`);
  }

  lines.push('');
  lines.push(`View in dashboard: ${dashboardLink}`);

  const message = lines.join('\n');

  // Hard safety limit for provider boundaries (Discord 2000 chars, Telegram 4096 chars)
  if (message.length > 1900) {
    return message.slice(0, 1897) + '...';
  }
  return message;
}

/**
 * Execute HTTP POST with 5s timeout and 1 automatic retry on network errors or 5xx responses.
 */
async function postWithRetry(
  url: string,
  bodyJson: string,
  providerLabel: string
): Promise<{ ok: boolean; error?: string }> {
  const maxRetries = 1;
  let lastError: string = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyJson,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        return { ok: true };
      }

      const resBody = await res.text().catch(() => '');
      const sanitized = sanitizeError(resBody || `HTTP ${res.status}`);

      // Retry on 5xx server errors
      if (res.status >= 500 && attempt < maxRetries) {
        lastError = `${providerLabel} server error (${res.status}): ${sanitized}`;
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }

      return { ok: false, error: `${providerLabel} error (${res.status}): ${sanitized}` };
    } catch (err: unknown) {
      clearTimeout(timeout);
      const errObj = err as Error;
      const isAbort = errObj?.name === 'AbortError' || errObj?.message?.includes('aborted');
      const errDesc = isAbort ? 'Request timed out after 5s' : sanitizeError(errObj?.message || 'Network error');
      lastError = `${providerLabel} network failure: ${errDesc}`;

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
    }
  }

  return { ok: false, error: lastError || `${providerLabel} dispatch failed` };
}

/**
 * Send plain text message via Telegram Bot API sendMessage endpoint.
 * Parses as plain text (no parse_mode) so customer content cannot inject or break markup.
 */
async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    return { ok: false, error: 'Telegram bot token or chat ID is missing in configuration.' };
  }

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: text,
  });

  return await postWithRetry(endpoint, body, 'Telegram');
}

/**
 * Send plain text message via Discord incoming webhook.
 */
async function sendDiscordMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    return { ok: false, error: 'Discord webhook URL is missing in configuration.' };
  }

  const body = JSON.stringify({
    content: text,
  });

  return await postWithRetry(webhookUrl, body, 'Discord');
}

/**
 * Retrieve active notification provider from environment.
 */
export function getActiveProvider(): NotifyProvider {
  const p = (process.env.NOTIFY_PROVIDER || 'none').toLowerCase().trim();
  if (p === 'telegram') return 'telegram';
  if (p === 'discord') return 'discord';
  return 'none';
}

/**
 * Core interface: notify business owner when a call ends and its summary is ready.
 * Wrapped completely so it NEVER throws into the call flow.
 */
export async function notifyCallSummary(payload: NotifyPayload): Promise<void> {
  try {
    const provider = getActiveProvider();
    if (provider === 'none') {
      // No-op for 'none'
      return;
    }

    // Guard idempotency: check if already notified in database
    const existing = db.prepare('SELECT notify_status FROM calls WHERE id=?').get(payload.callId) as { notify_status: string } | undefined;
    if (existing && existing.notify_status === 'sent') {
      return;
    }

    const message = formatCallNotification(payload);
    let result: { ok: boolean; error?: string };

    if (provider === 'telegram') {
      result = await sendTelegramMessage(message);
    } else if (provider === 'discord') {
      result = await sendDiscordMessage(message);
    } else {
      return;
    }

    const now = new Date().toISOString();
    if (result.ok) {
      console.log(`[notify] Owner notified via ${provider} for call ${payload.callId}`);
      db.prepare(
        'UPDATE calls SET notified_at=?, notify_status=?, notify_provider=?, notify_error=NULL WHERE id=?'
      ).run(now, 'sent', provider, payload.callId);

      events.broadcast('call_updated', {
        callId: payload.callId,
        notified_at: now,
        notify_status: 'sent',
        notify_provider: provider,
        notify_error: null,
      });
    } else {
      const sanitized = sanitizeError(result.error || 'Failed');
      console.error(`[notify] Owner notification failed via ${provider} for call ${payload.callId}: ${sanitized}`);
      db.prepare(
        'UPDATE calls SET notify_status=?, notify_provider=?, notify_error=? WHERE id=?'
      ).run('failed', provider, sanitized, payload.callId);

      events.broadcast('call_updated', {
        callId: payload.callId,
        notified_at: null,
        notify_status: 'failed',
        notify_provider: provider,
        notify_error: sanitized,
      });
    }
  } catch (err: unknown) {
    const errObj = err as Error;
    const sanitized = sanitizeError(errObj?.message || 'Unexpected failure');
    console.error(`[notify] Unexpected error sending owner notification: ${sanitized}`);
    try {
      db.prepare('UPDATE calls SET notify_status=?, notify_error=? WHERE id=?')
        .run('failed', sanitized, payload.callId);
    } catch {}
  }
}

/**
 * Resend notification for an existing call upon owner request in dashboard.
 */
export async function resendCallNotification(
  callId: string
): Promise<{ ok: boolean; provider: string; notified_at?: string; error?: string }> {
  const provider = getActiveProvider();
  if (provider === 'none') {
    return { ok: false, provider: 'none', error: 'No notification provider configured (NOTIFY_PROVIDER=none).' };
  }

  const call = db.prepare('SELECT * FROM calls WHERE id=?').get(callId) as {
    id: string;
    customer_phone: string;
    latency_json: string;
    usage_json: string;
    start_time: string;
    end_time: string;
    end_reason: string;
  } | undefined;
  if (!call) {
    return { ok: false, provider, error: 'Call not found.' };
  }

  const summary = db.prepare('SELECT * FROM summaries WHERE call_id=?').get(callId) as Record<string, unknown> | undefined;
  const business = db.prepare('SELECT name FROM businesses LIMIT 1').get() as { name: string } | undefined;

  const payload: NotifyPayload = {
    callId: call.id,
    businessName: business?.name || 'Business',
    customerPhone: call.customer_phone,
    endReason: call.end_reason,
    summary: summary || null,
  };

  const message = formatCallNotification(payload);
  let result: { ok: boolean; error?: string };

  if (provider === 'telegram') {
    result = await sendTelegramMessage(message);
  } else if (provider === 'discord') {
    result = await sendDiscordMessage(message);
  } else {
    return { ok: false, provider, error: `Unsupported provider: ${provider}` };
  }

  const now = new Date().toISOString();
  if (result.ok) {
    db.prepare(
      'UPDATE calls SET notified_at=?, notify_status=?, notify_provider=?, notify_error=NULL WHERE id=?'
    ).run(now, 'sent', provider, callId);

    events.broadcast('call_updated', {
      callId,
      notified_at: now,
      notify_status: 'sent',
      notify_provider: provider,
      notify_error: null,
    });

    return { ok: true, provider, notified_at: now };
  } else {
    const sanitized = sanitizeError(result.error || 'Failed');
    db.prepare(
      'UPDATE calls SET notify_status=?, notify_provider=?, notify_error=? WHERE id=?'
    ).run('failed', provider, sanitized, callId);

    events.broadcast('call_updated', {
      callId,
      notified_at: null,
      notify_status: 'failed',
      notify_provider: provider,
      notify_error: sanitized,
    });

    return { ok: false, provider, error: sanitized };
  }
}

/**
 * Send test notification ("Test from Missed-Call Rescuer") to verify owner configuration.
 */
export async function sendTestNotification(): Promise<{ ok: boolean; provider: string; error?: string }> {
  const provider = getActiveProvider();
  if (provider === 'none') {
    return { ok: false, provider: 'none', error: 'NOTIFY_PROVIDER is set to none or not configured.' };
  }

  const testMessage = 'Test from Missed-Call Rescuer';
  let result: { ok: boolean; error?: string };

  if (provider === 'telegram') {
    result = await sendTelegramMessage(testMessage);
  } else if (provider === 'discord') {
    result = await sendDiscordMessage(testMessage);
  } else {
    return { ok: false, provider, error: `Unsupported provider: ${provider}` };
  }

  if (result.ok) {
    return { ok: true, provider };
  } else {
    return { ok: false, provider, error: sanitizeError(result.error || 'Test notification failed.') };
  }
}
