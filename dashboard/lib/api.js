// Thin REST client with JWT handling (browser-only).
const BASE = process.env.NEXT_PUBLIC_API_BASE || '';

export function setToken(t) {
  if (typeof window === 'undefined') return;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}
export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function req(path, opts = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    setToken(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const api = {
  login: (email, password) =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  overview: () => req('/servers/overview'),
  servers: () => req('/servers'),
  server: (id) => req(`/servers/${id}`),
  metrics: (id, from, to) =>
    req(`/servers/${id}/metrics?` + new URLSearchParams({ ...(from && { from }), ...(to && { to }) })),
  securityEvents: (id, type) =>
    req(`/servers/${id}/security-events?` + new URLSearchParams({ ...(type && { type }) })),
  registerServer: (body) =>
    req('/servers', { method: 'POST', body: JSON.stringify(body) }),
  alerts: (status) => req('/alerts' + (status ? `?status=${status}` : '')),
  resolveAlert: (id) => req(`/alerts/${id}/resolve`, { method: 'POST' }),
};
