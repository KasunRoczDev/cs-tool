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
export function setRole(r) {
  if (typeof window === 'undefined') return;
  if (r) localStorage.setItem('role', r);
  else localStorage.removeItem('role');
}
export function getRole() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('role');
}

// Build a querystring from an object, dropping empty values.
function qs(obj = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
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
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.message) msg = Array.isArray(j.message) ? j.message.join(', ') : j.message; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  login: (email, password) =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  mfaVerify: (mfa_token, code) =>
    req('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ mfa_token, code }) }),
  mfaEnroll: (mfa_token, code) =>
    req('/auth/mfa/enroll', { method: 'POST', body: JSON.stringify({ mfa_token, code }) }),
  me: () => req('/auth/me'),
  overview: () => req('/servers/overview'),
  servers: () => req('/servers'),
  server: (id) => req(`/servers/${id}`),
  metrics: (id, from, to) =>
    req(`/servers/${id}/metrics` + qs({ from, to })),
  securityEvents: (id, type) =>
    req(`/servers/${id}/security-events` + qs({ type })),
  registerServer: (body) =>
    req('/servers', { method: 'POST', body: JSON.stringify(body) }),
  updateServer: (id, body) =>
    req(`/servers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  vulnerabilityReport: () => req('/servers/vulnerability-report'),
  // products
  products: () => req('/products'),
  createProduct: (body) => req('/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id, body) => req(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduct: (id) => req(`/products/${id}`, { method: 'DELETE' }),
  alerts: (status) => req('/alerts' + (status ? `?status=${status}` : '')),
  resolveAlert: (id) => req(`/alerts/${id}/resolve`, { method: 'POST' }),
  // users (RBAC)
  users: () => req('/users'),
  createUser: (body) => req('/users', { method: 'POST', body: JSON.stringify(body) }),
  setUserRole: (id, role) => req(`/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  setUserPassword: (id, password) => req(`/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) }),
  changeOwnPassword: (password) => req('/users/me/password', { method: 'PATCH', body: JSON.stringify({ password }) }),
  deleteUser: (id) => req(`/users/${id}`, { method: 'DELETE' }),
  // security analytics
  secEvents: (f) => req('/security/events' + qs(f)),
  secStats: (f) => req('/security/stats' + qs(f)),
  secGrouped: (f) => req('/security/grouped' + qs(f)),
  secTypes: () => req('/security/types'),
  // platform settings (admin)
  getSettings: () => req('/settings'),
  saveSettings: (body) => req('/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  // notifications
  notifChannels: () => req('/notifications/channels'),
  createChannel: (body) => req('/notifications/channels', { method: 'POST', body: JSON.stringify(body) }),
  updateChannel: (id, body) => req(`/notifications/channels/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteChannel: (id) => req(`/notifications/channels/${id}`, { method: 'DELETE' }),
  testChannel: (id) => req(`/notifications/channels/${id}/test`, { method: 'POST' }),
  notifRules: (channelId) => req('/notifications/rules' + (channelId ? `?channelId=${channelId}` : '')),
  createRule: (body) => req('/notifications/rules', { method: 'POST', body: JSON.stringify(body) }),
  updateRule: (id, body) => req(`/notifications/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRule: (id) => req(`/notifications/rules/${id}`, { method: 'DELETE' }),
  notifLog: (limit) => req('/notifications/log' + (limit ? `?limit=${limit}` : '')),
  // ── Analysis ──────────────────────────────────────────────────────────
  getAnalysisAll:    (window) => req('/analysis' + (window ? `?window=${window}` : '')),
  getAnalysisServer: (id, window) => req(`/analysis/${id}` + (window ? `?window=${window}` : '')),
  // ── Topology (server graph relations, per product + environment) ──────
  topology:     (productId, env) => req(`/topology/${productId}/${env}`),
  topologyEnvs: (productId) => req(`/topology/${productId}/environments`),
  saveTopology: (productId, env, graph) =>
    req(`/topology/${productId}/${env}`, { method: 'PUT', body: JSON.stringify(graph) }),
};
