const BASE =
  // In dev we rely on Vite proxy, so leave BASE blank
  (import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_ORIGIN || ''));

export async function getJson(path: string, opts: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => ({})) : await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${isJson ? JSON.stringify(body) : body}`);
  }
  return isJson ? res.json() : res.text();
}
