import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const ACCESS_CODE = process.env.ACCESS_CODE?.trim();
const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || (process.env.NODE_ENV !== 'production' ? 'dev-session-secret-missed-call-rescuer' : '');

export function validateStartupAuth(): void {
  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!ACCESS_CODE) missing.push('ACCESS_CODE');
    if (!SESSION_SECRET) missing.push('SESSION_SECRET');

    if (missing.length > 0) {
      console.error(`[FATAL] Missing required production environment variable(s): ${missing.join(', ')}`);
      console.error('The application refuses to start in production without authentication configured.');
      process.exit(1);
    }
  } else {
    if (!ACCESS_CODE) {
      console.warn('[AUTH] ACCESS_CODE is unset. Running in open access mode (development only).');
    }
  }
}

export function isOpenAccess(): boolean {
  return !ACCESS_CODE && process.env.NODE_ENV !== 'production';
}

/**
 * Constant-time comparison for access code
 */
export function verifyAccessCode(inputCode: string): boolean {
  if (!ACCESS_CODE) {
    return isOpenAccess();
  }
  if (!inputCode || typeof inputCode !== 'string') return false;

  // Use SHA-256 digests so both buffers have identical 32-byte lengths
  const expectedHash = crypto.createHash('sha256').update(ACCESS_CODE).digest();
  const actualHash = crypto.createHash('sha256').update(inputCode.trim()).digest();

  return crypto.timingSafeEqual(expectedHash, actualHash);
}

interface TokenPayload {
  role: 'judge' | 'owner';
  exp: number;
  nonce?: string;
}

/**
 * Sign HMAC token with 12-hour expiration
 */
export function signAuthToken(role: 'judge' | 'owner' = 'judge', ttlMs: number = 12 * 60 * 60 * 1000): string {
  const secret = SESSION_SECRET || 'dev-session-secret';
  const payload: TokenPayload = {
    role,
    exp: Date.now() + ttlMs,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify HMAC token
 */
export function verifyAuthToken(token: string): TokenPayload | null {
  if (isOpenAccess()) {
    return { role: 'judge', exp: Date.now() + 60000 };
  }
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const secret = SESSION_SECRET || 'dev-session-secret';
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate 60-second single-purpose stream token for SSE
 */
export function signStreamToken(): string {
  return signAuthToken('judge', 60 * 1000);
}

/**
 * Express middleware requiring Bearer token
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isOpenAccess()) {
    return next();
  }

  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query?.stream_token && typeof req.query.stream_token === 'string') {
    token = req.query.stream_token;
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized: valid access token required' });
    return;
  }

  (req as any).user = payload;
  next();
}
