'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getToken, setToken, setRole, getRole } from '@/lib/api';
import { getSocket } from '@/lib/socket';

export default function Shell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState(null);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else { setRoleState(getRole()); setReady(true); }
  }, [router]);

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
      section: 'Release Management',
      items: [
        { href: '/repositories', label: '📚 Repositories' },
        { href: '/releases',     label: '🚀 Releases' },
        { href: '/release-board', label: '🗂️ Release Board' },
        { href: '/deployments',  label: '🛳️ Deployments' },
        { href: '/ai',           label: '🤖 AI Assistant' },
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
      <main className="content">{children}</main>
    </div>
  );
}
