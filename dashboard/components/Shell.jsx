'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, getToken, setToken, setRole, getRole } from '@/lib/api';
import { getSocket } from '@/lib/socket';

const PASSKEY_NUDGE_DISMISSED_KEY = 'passkeyNudgeDismissed';

export default function Shell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const [showPasskeyNudge, setShowPasskeyNudge] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else { setRoleState(getRole()); setReady(true); }
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    if (localStorage.getItem(PASSKEY_NUDGE_DISMISSED_KEY)) return;
    api.myPasskeys()
      .then((passkeys) => setShowPasskeyNudge(passkeys.length === 0))
      .catch(() => {});
  }, [ready]);

  const dismissPasskeyNudge = () => {
    localStorage.setItem(PASSKEY_NUDGE_DISMISSED_KEY, '1');
    setShowPasskeyNudge(false);
  };

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onAlert = (a) =>
      setAlertCount((c) => (a.status === 'resolved' ? Math.max(0, c - 1) : c + 1));
    s.on('alert', onAlert);
    return () => s.off('alert', onAlert);
  }, []);

  if (!ready) return null;

  // Sidebar grouped by service so Monitoring and Release Management are clearly separated.
  const navGroups = [
    {
      section: null, // top-level, no header
      items: [
        { href: '/', label: '🖥️ Overview' },
      ],
    },
    {
      section: 'Monitoring',
      items: [
        { href: '/products',             label: '📦 Products' },
        { href: '/apps',                 label: '🗂️ Apps' },
        { href: '/topology',             label: '🕸️ Topology' },
        { href: '/performance',          label: '📈 Performance' },
        { href: '/service-metrics',      label: '📊 Service Metrics' },
        { href: '/fpm',                  label: '🐘 PHP-FPM' },
        { href: '/security',             label: '🔒 Security' },
        { href: '/vulnerability-report', label: '🛡️ Vuln Report' },
        { href: '/alerts',               label: '🔔 Alerts' },
        { href: '/compare',              label: '⚖️ Compare' },
        { href: '/notifications',        label: '✉️ Notifications' },
        { href: '/analysis',             label: '🔬 Analysis' },
      ],
    },
    {
      section: 'Billing',
      items: [
        { href: '/billing/dashboard',     label: '💰 Billing Dashboard' },
        { href: '/billing/services',      label: '🧾 Services' },
        { href: '/billing/service-types', label: '🏷️ Service Types' },
        { href: '/billing/monthly-entry', label: '📅 Monthly Entry' },
        { href: '/billing/history',       label: '📜 Billing History' },
        { href: '/billing/report',        label: '📋 Billing Report' },
      ],
    },
    {
      section: 'Release Management',
      items: [
        { href: '/release-dashboard', label: '🏠 Release Dashboard' },
        { href: '/repositories', label: '📚 Repositories' },
        { href: '/releases',     label: '🚀 Releases' },
        { href: '/release-board', label: '🗂️ Release Board' },
        { href: '/deployments',  label: '🛳️ Deployments' },
        { href: '/release-metrics', label: '📈 Release Metrics' },
        { href: '/release-calendar', label: '📅 Release Calendar' },
        { href: '/environments', label: '🌐 Environments' },
        { href: '/ai',           label: '🤖 AI Assistant' },
        ...(role === 'admin' ? [{ href: '/release-workflows', label: '🧭 Workflow Config' }] : []),
        ...(role === 'admin' ? [{ href: '/audit-log', label: '🧾 Audit Log' }] : []),
        ...(role === 'admin' ? [{ href: '/agent-updates', label: '🛰️ Agent Updates' }] : []),
      ],
    },
    {
      section: 'System',
      items: [
        { href: '/setup', label: '📋 Setup Guide' },
        ...(role === 'admin' ? [{ href: '/users', label: '👥 Users' }] : []),
        ...(role === 'admin' ? [{ href: '/access', label: '🔐 Access Control' }] : []),
        // Personal account security (passkeys, trusted devices) — per-user, not shared app config.
        { href: '/profile', label: '👤 My Profile' },
        // Settings available to all roles (theme); SMTP read-only for non-admin
        { href: '/settings', label: '⚙️ Settings' },
      ],
    },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">🛡️ Monitor</div>
        <nav>
          {navGroups.map((group, gi) => (
            <div key={group.section ?? `group-${gi}`} className="nav-group">
              {group.section && <div className="nav-section">{group.section}</div>}
              {group.items.map((n) => (
                <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
                  {n.label}
                  {n.href === '/alerts' && alertCount > 0 && <span className="badge"> {alertCount}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="role-tag">{role}</div>
        <button className="logout" onClick={() => { setToken(null); setRole(null); router.push('/login'); }}>
          Log out
        </button>
      </aside>
      <main className="content">
        {showPasskeyNudge && pathname !== '/profile' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '10px 16px', marginBottom: 16, fontSize: 13,
          }}>
            <span>🔑 Set up a passkey for faster, more secure sign-in.</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Link href="/profile" className="btn-primary" style={{
                padding: '6px 12px', borderRadius: 6, fontWeight: 600, fontSize: 12,
              }}>Set up</Link>
              <button onClick={dismissPasskeyNudge} style={{
                background: 'transparent', border: 'none', color: 'var(--muted)',
                cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0,
              }} aria-label="Dismiss">✕</button>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
