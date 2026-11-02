import { Request, Response, NextFunction } from 'express';
import db from './db';
import { sessions } from './session';

export const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || '2', 10);
export const MAX_CALLS_PER_DAY = parseInt(process.env.MAX_CALLS_PER_DAY || '100', 10);
export const MAX_CALL_SECONDS = parseInt(process.env.MAX_CALL_SECONDS || '300', 10);

// In-memory rate limiting map: key -> timestamps[]
const rateLimitBuckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number = 60000
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    return { allowed: false, remaining: 0 };
  }
  timestamps.push(now);
  // Bound memory for long-running processes; stale buckets are pruned lazily.
  if (rateLimitBuckets.size > 10000) {
    for (const [k, v] of rateLimitBuckets) {
      if (!v.some((t) => now - t < windowMs)) rateLimitBuckets.delete(k);
    }
  }
  rateLimitBuckets.set(key, timestamps);
  return { allowed: true, remaining: limit - timestamps.length };
}

export function createRateLimiter(action: string, maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${action}:${ip}`;
    if (!checkRateLimit(key, maxPerMinute, 60000).allowed) {
      res.status(429).json({ error: 'Too many requests. Please slow down and try again in a moment.' });
      return;
    }
    next();
  };
}

export function getAllowedOrigins(): string[] {
  const envVal = process.env.ALLOWED_ORIGINS?.trim();
  const configured = envVal
    ? envVal.split(',').map((s) => s.trim().toLowerCase().replace(/\/+$/, '')).filter(Boolean)
    : [];

  const defaults = [
    'https://missed-call-rescuer.vercel.app',
    'http://localhost:3010',
    'http://127.0.0.1:3010',
  ];

  return Array.from(new Set([...defaults, ...configured]));
}

export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) {
    // In production, reject requests without an Origin header where origin is required (WebSocket / SSE)
    return process.env.NODE_ENV !== 'production';
  }
  const cleanOrigin = origin.trim().toLowerCase().replace(/\/+$/, '');
  const allowed = getAllowedOrigins();

  if (allowed.includes(cleanOrigin)) {
    return true;
  }

  // Allow Vercel preview deployment URLs for this project
  if (/^https:\/\/missed-call-rescuer(-[a-z0-9-]+)?\.vercel\.app$/.test(cleanOrigin)) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production') {
    if (cleanOrigin.startsWith('http://localhost:') || cleanOrigin.startsWith('http://127.0.0.1:')) {
      return true;
    }
  }

  return false;
}

export function checkCallBudget(): { allowed: boolean; reason?: string } {
  // Check active concurrent calls
  let activeCount = 0;
  for (const session of sessions.values()) {
    if (!session.ended) activeCount++;
  }
  if (activeCount >= MAX_CONCURRENT_CALLS) {
    return { allowed: false, reason: 'Demo is busy, try again in a minute' };
  }

  // Check 24-hour call cap
  try {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM calls WHERE julianday(start_time) >= julianday('now', '-24 hours')`).get() as { cnt: number } | undefined;
    if (row && row.cnt >= MAX_CALLS_PER_DAY) {
      return { allowed: false, reason: 'Daily demo limit reached. Please try again tomorrow.' };
    }
  } catch {}

  return { allowed: true };
}

export function sanitizeClientError(err: unknown): string {
  if (!err) return 'Internal Server Error';
  const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : '');
  if (process.env.NODE_ENV === 'production') {
    return 'An unexpected error occurred. Please try again later.';
  }
  return msg.replace(/(?:key=|token=|bearer\s+)[^\s&]+/gi, '[redacted]');
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
