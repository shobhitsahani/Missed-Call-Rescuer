export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

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
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

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
