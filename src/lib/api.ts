function normaliseBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getApiBase(): string {
  // Explicit configuration always wins, in every environment. This is what
  // Vercel/Render deployments use to point at a non-default backend.
  const explicit = process.env.NEXT_PUBLIC_API_BASE;
  if (explicit && explicit.trim()) {
    return normaliseBase(explicit);
  }

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return 'http://localhost:4000';
    }
    if (hostname.includes('vercel.app') || protocol === 'https:') {
      return 'https://missed-call-rescuer-api.onrender.com';
    }
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://missed-call-rescuer-api.onrender.com';
  }
  return 'http://localhost:4000';
}

export const API_BASE = getApiBase();

export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path: string, init: RequestInit = {}) {
  const base = getApiBase();
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(0, `Unable to connect to server (${base}). ${msg}`);
  }

  if (!res.ok) {
    let errorBody: Record<string, unknown> | null = null;
    try {
      errorBody = await res.json();
    } catch {}
    const msg = (typeof errorBody?.error === 'string' ? errorBody.error : null) || `API error (${res.status})`;
    throw new ApiError(res.status, msg, errorBody);
  }

  return res.json();
}
