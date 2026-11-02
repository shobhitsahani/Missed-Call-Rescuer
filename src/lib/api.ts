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

  // 10-second default request timeout to prevent permanent loading states
  const controller = new AbortController();
  const timeoutMs = 10000;
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  // If caller provided their own signal, listen to it as well
  if (init.signal) {
    if (init.signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      init.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      });
    }
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    let msg = err instanceof Error ? err.message : 'Network error';
    if (didTimeout) {
      msg = `Request timed out after ${timeoutMs / 1000}s`;
    }
    throw new ApiError(0, `Unable to connect to server (${base}). ${msg}`);
  } finally {
    clearTimeout(timeoutId);
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
