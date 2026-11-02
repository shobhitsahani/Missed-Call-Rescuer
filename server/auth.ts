import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const ACCESS_CODE = process.env.ACCESS_CODE?.trim();
const SESSION_SECRET = process.env.SESSION_SECRET?.trim() || 'hackathon-open-secret';

export function validateStartupAuth(): void {
  if (ACCESS_CODE) {
    console.log('[AUTH] ACCESS_CODE configured. Protected dashboard access active.');
  } else {
    console.log('[AUTH] Open access mode enabled (hackathon demo). No ACCESS_CODE or SESSION_SECRET required.');
  }
}

export function isOpenAccess(): boolean {
  return !ACCESS_CODE;
}

/**
 * Constant-time comparison for access code (optional fallback if ACCESS_CODE is provided)
 */
export function verifyAccessCode(inputCode: string): boolean {
  if (!ACCESS_CODE) {
    return true;
  }
  if (!inputCode || typeof inputCode !== 'string') return false;

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
 * Sign HMAC token (retained for backward compatibility)
 */
export function signAuthToken(role: 'judge' | 'owner' = 'judge', ttlMs: number = 12 * 60 * 60 * 1000): string {
  const payload: TokenPayload = {
    role,
    exp: Date.now() + ttlMs,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify HMAC token
 */
export function verifyAuthToken(token: string): TokenPayload | null {
  if (isOpenAccess()) {
    return { role: 'judge', exp: Date.now() + 86400000 };
  }
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');

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
 * Generate stream token for SSE (retained for backward compatibility)
 */
export function signStreamToken(): string {
  return signAuthToken('judge', 60 * 1000);
}

/**
 * Express middleware requiring Bearer token (no-op in open access mode)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isOpenAccess()) {
    (req as Request & { user?: TokenPayload }).user = { role: 'judge', exp: Date.now() + 86400000 };
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

  (req as Request & { user?: TokenPayload }).user = payload;
  next();
}
