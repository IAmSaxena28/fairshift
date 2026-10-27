/** Thin fetch wrapper. Every call sends JSON; confidential calls omit cookies entirely. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, url: string, body?: unknown, credentials: RequestCredentials = 'same-origin'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  /** For confidential reporting: the browser sends no cookie, so the server cannot link the report to a login. */
  postAnonymous: <T>(url: string, body: unknown) => request<T>('POST', url, body, 'omit'),
  getAnonymous: <T>(url: string) => request<T>('GET', url, undefined, 'omit'),
};
