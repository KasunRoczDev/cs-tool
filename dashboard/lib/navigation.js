// Canonical dashboard destinations. Detail patterns provide context, not sidebar links.
// Keep this separate from routeMap.js, which labels API requests.
const route = (href, label, workspace, icon, description, options = {}) => ({
  href, label, title: label, workspace, icon, description, ...options,
});

export const routeMetadata = Object.freeze([
  route('/', 'Overview', 'Home', 'overview', 'Monitor infrastructure health and the issues that need attention.', { exact: true }),
  route('/alerts', 'Alerts', 'Home', 'alerts', 'Review active alerts and follow up on operational issues.'),
  route('/notifications', 'Notifications', 'Home', 'notifications', 'Manage notification channels and delivery preferences.'),

  route('/products', 'Products', 'Observe', 'products', 'Organize products and their infrastructure.'),
  route('/apps', 'Apps', 'Observe', 'apps', 'Manage applications and their linked servers.'),
  route('/topology', 'Topology', 'Observe', 'topology', 'Explore infrastructure connections and dependencies.'),
  route('/performance', 'Performance', 'Observe', 'performance', 'Investigate resource usage and performance trends.'),
  route('/service-metrics', 'Service metrics', 'Observe', 'monitoring', 'Inspect application and service telemetry.'),
  route('/fpm', 'PHP-FPM', 'Observe', 'monitoring', 'Monitor PHP-FPM pools and worker activity.'),
  route('/compare', 'Compare', 'Observe', 'performance', 'Compare server metrics side by side.'),

  route('/security', 'Security', 'Secure', 'security', 'Review security events across your infrastructure.'),
  route('/vulnerability-report', 'Vulnerability report', 'Secure', 'security', 'Review detected vulnerabilities and remediation priorities.'),
  route('/analysis', 'Analysis', 'Secure', 'monitoring', 'Investigate security findings and server posture.'),
  route('/audit-log', 'Audit log', 'Secure', 'admin-tools', 'Review recorded administrative and delivery activity.', { requiredRole: 'admin' }),
  route('/access', 'Access control', 'Secure', 'access', 'Manage access permissions for users and products.', { requiredRole: 'admin' }),

  route('/release-dashboard', 'Release dashboard', 'Deliver', 'overview', 'Review delivery activity and release status.'),
  route('/repositories', 'Repositories', 'Deliver', 'repositories', 'Manage source repositories used by your releases.'),
  route('/releases', 'Releases', 'Deliver', 'releases', 'Plan releases and track their progress.'),
  route('/release-board', 'Release board', 'Deliver', 'releases', 'Track releases across workflow stages.'),
  route('/deployments', 'Deployments', 'Deliver', 'deployments', 'Monitor deployment jobs and their outcomes.'),
  route('/release-metrics', 'Release metrics', 'Deliver', 'performance', 'Review delivery performance and release trends.'),
  route('/release-calendar', 'Release calendar', 'Deliver', 'releases', 'View releases and scheduled delivery activity.'),
  route('/environments', 'Environments', 'Deliver', 'environments', 'Manage the environments used for delivery.'),
  route('/release-workflows', 'Workflow configuration', 'Deliver', 'admin-tools', 'Configure release workflow stages and transitions.', { requiredRole: 'admin' }),
  route('/agent-updates', 'Agent updates', 'Deliver', 'admin-tools', 'Manage monitoring agent versions and updates.', { requiredRole: 'admin' }),
  route('/ai', 'AI assistant', 'Deliver', 'admin-tools', 'Get assistance with operational and delivery questions.'),

  route('/billing/dashboard', 'Billing dashboard', 'FinOps', 'billing', 'Review infrastructure costs and billing trends.'),
  route('/billing/services', 'Services', 'FinOps', 'billing', 'Manage billable services and their product assignments.'),
  route('/billing/service-types', 'Service types', 'FinOps', 'billing', 'Manage service categories and billing units.'),
  route('/billing/monthly-entry', 'Monthly entry', 'FinOps', 'billing', 'Record monthly service usage and costs.'),
  route('/billing/history', 'Billing history', 'FinOps', 'billing', 'Review and manage recorded billing entries.'),
  route('/billing/report', 'Billing report', 'FinOps', 'billing', 'Explore billing totals by period and product.'),

  route('/setup', 'Setup guide', 'Admin', 'setup', 'Set up monitoring agents and connect infrastructure.'),
  route('/users', 'Users', 'Admin', 'users', 'Manage user accounts and roles.', { requiredRole: 'admin' }),
  route('/profile', 'My profile', 'Admin', 'profile', 'Manage your account security, passkeys, and trusted devices.'),
  route('/settings', 'Settings', 'Admin', 'settings', 'Manage appearance and view system configuration.'),

  route('/apps/[id]', 'App details', 'Observe', 'apps', 'Review application configuration and linked infrastructure.', { navigation: false, parent: '/apps' }),
  // Servers are listed on Overview; there is no committed /servers index route.
  route('/servers/[id]', 'Server details', 'Observe', 'monitoring', 'Inspect server health, metrics, and security events.', { navigation: false, parent: '/' }),
  route('/releases/[id]', 'Release details', 'Deliver', 'releases', 'Manage release contents, approvals, and deployments.', { navigation: false, parent: '/releases' }),
].map(Object.freeze));

const workspaces = ['Home', 'Observe', 'Secure', 'Deliver', 'FinOps', 'Admin'];
const routesByHref = new Map(routeMetadata.map((entry) => [entry.href, entry]));
const routeSegments = (href) => href.split('/').filter(Boolean);
const isParameter = (segment) => segment.startsWith('[') && segment.endsWith(']');
const contextRoutes = routeMetadata.map((entry) => ({
  entry,
  segments: routeSegments(entry.href),
})).sort((a, b) => b.segments.length - a.segments.length
  || a.segments.filter(isParameter).length - b.segments.filter(isParameter).length);

/** Visible sidebar groups shaped like Shell's existing { section, items } groups.
 * Role filtering is presentation only; route/API authorization remains unchanged.
 */
export function navigationGroups(role) {
  return workspaces.map((section) => ({
    section,
    items: routeMetadata
      .filter((entry) => entry.workspace === section && entry.navigation !== false
        && (!entry.requiredRole || entry.requiredRole === role))
      .map(({ href, label, icon, description, exact, requiredRole }) => ({
        href, label, icon, description,
        ...(exact ? { exact } : {}),
        ...(requiredRole ? { requiredRole } : {}),
      })),
  })).filter((group) => group.items.length > 0);
}

function pageContext(entry, href = entry.href) {
  const { workspace, title, description } = entry;
  const parent = routesByHref.get(entry.parent);
  return {
    workspace, title, description, href,
    ...(parent ? { parent: pageContext(parent) } : {}),
  };
}

/** Resolve exact routes, concrete detail IDs, then the nearest registered ancestor.
 * Unknown paths return null so consumers never invent navigation destinations.
 */
export function getPageContext(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  // /dashboard is the existing redirect to Security, not another destination.
  if (path === '/dashboard') return pageContext(routesByHref.get('/security'));
  const segments = routeSegments(path);
  for (const { entry, segments: pattern } of contextRoutes) {
    if (pattern.length > segments.length || (entry.exact && path !== entry.href)) continue;
    if (pattern.every((segment, index) => isParameter(segment) || segment === segments[index])) {
      const href = pattern.some(isParameter)
        ? `/${segments.slice(0, pattern.length).join('/')}`
        : entry.href;
      return pageContext(entry, href);
    }
  }
  return null;
}
