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
    credentials: 'include',
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
  mfaVerify: (mfa_token, code, trust_device = false) =>
    req('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ mfa_token, code, trust_device }) }),
  mfaEnroll: (mfa_token, code, trust_device = false) =>
    req('/auth/mfa/enroll', { method: 'POST', body: JSON.stringify({ mfa_token, code, trust_device }) }),
  // passkeys (passwordless login + management)
  passkeyLoginOptions: (email) =>
    req('/auth/passkeys/login/options', { method: 'POST', body: JSON.stringify({ email }) }),
  passkeyLoginVerify: (auth_token, credential) =>
    req('/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify({ auth_token, credential }) }),
  passkeyRegisterOptions: () => req('/auth/passkeys/register/options', { method: 'POST' }),
  passkeyRegisterVerify: (reg_token, credential) =>
    req('/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify({ reg_token, credential }) }),
  myPasskeys: () => req('/auth/passkeys'),
  deletePasskey: (id) => req(`/auth/passkeys/${id}`, { method: 'DELETE' }),
  // trusted devices
  myTrustedDevices: () => req('/auth/devices'),
  revokeTrustedDevice: (id) => req(`/auth/devices/${id}`, { method: 'DELETE' }),
  revokeAllTrustedDevices: () => req('/auth/devices', { method: 'DELETE' }),
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

  // -- Release Management -------------------------------------------------
  // Repositories + versions
  repositories: () => req('/repositories'),
  repository: (id) => req(`/repositories/${id}`),
  createRepository: (body) => req('/repositories', { method: 'POST', body: JSON.stringify(body) }),
  updateRepository: (id, body) => req(`/repositories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRepository: (id) => req(`/repositories/${id}`, { method: 'DELETE' }),
  syncRepository: (id) => req(`/repositories/${id}/sync`, { method: 'POST' }),
  repoBranches: (id) => req(`/repositories/${id}/branches`),
  createBranch: (id, body) => req(`/repositories/${id}/branches`, { method: 'POST', body: JSON.stringify(body) }),
  deleteBranch: (id, name) => req(`/repositories/${id}/branches${qs({ name })}`, { method: 'DELETE' }),
  compareBranches: (id, base, head) => req(`/repositories/${id}/branches/compare${qs({ base, head })}`),
  branchConflicts: (id, base, head) => req(`/repositories/${id}/branches/conflicts${qs({ base, head })}`),
  branchHistory: (id, branch, limit = 50) => req(`/repositories/${id}/branches/history${qs({ branch, limit })}`),
  repoCommits: (id, branch, limit = 50) => req(`/repositories/${id}/commits${qs({ branch, limit })}`),
  repoVersions: (id) => req(`/repositories/${id}/versions`),
  createRepoVersion: (id, body) => req(`/repositories/${id}/versions`, { method: 'POST', body: JSON.stringify(body) }),
  // Releases
  releases: () => req('/releases'),
  release: (id) => req(`/releases/${id}`),
  createRelease: (body) => req('/releases', { method: 'POST', body: JSON.stringify(body) }),
  updateRelease: (id, body) => req(`/releases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addReleaseRepo: (id, body) => req(`/releases/${id}/repositories`, { method: 'POST', body: JSON.stringify(body) }),
  removeReleaseRepo: (id, linkId) => req(`/releases/${id}/repositories/${linkId}`, { method: 'DELETE' }),
  addReleaseItem: (id, body) => req(`/releases/${id}/items`, { method: 'POST', body: JSON.stringify(body) }),
  removeReleaseItem: (id, itemId) => req(`/releases/${id}/items/${itemId}`, { method: 'DELETE' }),
  promoteRelease: (id) => req(`/releases/${id}/promote`, { method: 'POST' }),
  archiveRelease: (id) => req(`/releases/${id}/archive`, { method: 'POST' }),
  generateReleaseNotes: (id) => req(`/releases/${id}/release-notes/generate`, { method: 'POST' }),
  releaseNotes: (id) => req(`/releases/${id}/release-notes`),
  // Deployments
  channels: () => req('/channels'),
  deployments: () => req('/deployments'),
  deploymentBoard: () => req('/deployments/board'),
  deploymentHistory: (id) => req(`/deployments/${id}/history`),
  deploymentJobs: (id) => req(`/deployments/${id}/jobs`),
  deployJobLog: (jobId) => req(`/deploy-jobs/${jobId}/log`),
  // body: { channel, server_ids?, branch?, custom_commands? } (string allowed for back-compat)
  deployRelease: (id, body) => req(`/releases/${id}/deployments`, {
    method: 'POST',
    body: JSON.stringify(typeof body === 'string' ? { channel: body } : body),
  }),
  approveDeployment: (id) => req(`/deployments/${id}/approve`, { method: 'POST' }),
  rollbackDeployment: (id) => req(`/deployments/${id}/rollback`, { method: 'POST' }),
  cancelDeployment: (id) => req(`/deployments/${id}/cancel`, { method: 'POST' }),
  retryDeployment: (id) => req(`/deployments/${id}/retry`, { method: 'POST' }),
  // ── AI Assistant ───────────────────────────────────────────────────────
  aiStatus: () => req('/ai/status'),
  aiRisk: (id, channel) => req(`/ai/releases/${id}/risk${qs({ channel })}`),
  aiPredict: (id, channel) => req(`/ai/releases/${id}/predict${qs({ channel })}`),
  aiRollbackPlan: (id, channel) => req(`/ai/releases/${id}/rollback-plan${qs({ channel })}`),
  aiReleaseNotes: (id) => req(`/ai/releases/${id}/notes`),
  aiRiskyPrs: (repoId) => req(`/ai/repositories/${repoId}/risky-prs`),
  aiReviewers: (repoId, number) => req(`/ai/repositories/${repoId}/prs/${number}/reviewers`),
  aiBreakingChanges: (repoId, number) => req(`/ai/repositories/${repoId}/prs/${number}/breaking-changes`),
  aiIncidents: (hours) => req(`/ai/incidents${qs({ hours })}`),
  // ── Release approvals ──────────────────────────────────────────────────
  setUserApprovalProfile: (id, body) =>
    req(`/users/${id}/approval-profile`, { method: 'PATCH', body: JSON.stringify(body) }),
  releaseApprovals: (id) => req(`/releases/${id}/approvals`),
  // Multipart submit (remark + optional attachment) — must NOT force JSON content-type.
  submitApproval: async (id, formData) => {
    const token = getToken();
    const res = await fetch(`${BASE}/api/v1/releases/${id}/approvals`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
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
    return res.json();
  },
  // ── Access control (RBAC) ──────────────────────────────────────────────
  myPermissions: (product) => req(`/me/permissions${qs({ product })}`),
  permissions: () => req('/permissions'),
  roles: () => req('/roles'),
  createRole: (body) => req('/roles', { method: 'POST', body: JSON.stringify(body) }),
  setRolePermissions: (id, permission_keys) => req(`/roles/${id}/permissions`, { method: 'PUT', body: JSON.stringify({ permission_keys }) }),
  deleteRole: (id) => req(`/roles/${id}`, { method: 'DELETE' }),
  productMembers: (id) => req(`/products/${id}/members`),
  addProductMember: (id, body) => req(`/products/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),
  revokeMembership: (id) => req(`/memberships/${id}`, { method: 'DELETE' }),
  grantMembership: (body) => req('/memberships', { method: 'POST', body: JSON.stringify(body) }),
  // ── Release status state machine ───────────────────────────────────────
  workflows: () => req('/workflows'),
  releaseBoard: () => req('/release-board'),
  releaseStatus: (id) => req(`/releases/${id}/status`),
  releaseStatusHistory: (id) => req(`/releases/${id}/status-history`),
  transitionRelease: (id, to_status_key, note) => req(`/releases/${id}/transition`, { method: 'POST', body: JSON.stringify({ to_status_key, note }) }),
  // Authenticated attachment download → triggers a browser save.
  downloadApprovalAttachment: async (attId, filename) => {
    const token = getToken();
    const res = await fetch(`${BASE}/api/v1/approval-attachments/${attId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'attachment';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  },
};
