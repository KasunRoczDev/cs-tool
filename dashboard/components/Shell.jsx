'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, getToken, setToken, setRole, getRole } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import Icon from './Icon';

const PASSKEY_NUDGE_DISMISSED_KEY = 'passkeyNudgeDismissed';

export default function Shell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const [showPasskeyNudge, setShowPasskeyNudge] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarRef = useRef(null);
  const mobileToggleRef = useRef(null);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const sidebar = sidebarRef.current;
    const mobileToggle = mobileToggleRef.current;
    const previousOverflow = document.body.style.overflow;
    const desktop = window.matchMedia('(min-width: 761px)');
    document.body.style.overflow = 'hidden';
    sidebar?.querySelector('button, a[href]')?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
      }
      if (event.key !== 'Tab' || !sidebar) return;
      const controls = sidebar.querySelectorAll('a[href], button');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onResize = () => { if (desktop.matches) setMobileNavOpen(false); };
    onResize();
    window.addEventListener('keydown', onKeyDown);
    desktop.addEventListener('change', onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onResize);
      mobileToggle?.focus();
    };
  }, [mobileNavOpen]);

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
        { href: '/', label: 'Overview', icon: 'overview' },
      ],
    },
    {
      section: 'Monitoring',
      items: [
        { href: '/products', label: 'Products', icon: 'products' },
        { href: '/apps', label: 'Apps', icon: 'apps' },
        { href: '/topology', label: 'Topology', icon: 'topology' },
        { href: '/performance', label: 'Performance', icon: 'performance' },
        { href: '/service-metrics', label: 'Service Metrics', icon: 'monitoring' },
        { href: '/fpm', label: 'PHP-FPM', icon: 'monitoring' },
        { href: '/security', label: 'Security', icon: 'security' },
        { href: '/vulnerability-report', label: 'Vuln Report', icon: 'security' },
        { href: '/alerts', label: 'Alerts', icon: 'alerts' },
        { href: '/compare', label: 'Compare', icon: 'performance' },
        { href: '/notifications', label: 'Notifications', icon: 'notifications' },
        { href: '/analysis', label: 'Analysis', icon: 'monitoring' },
      ],
    },
    {
      section: 'Billing',
      items: [
        { href: '/billing/dashboard', label: 'Billing Dashboard', icon: 'billing' },
        { href: '/billing/services', label: 'Services', icon: 'billing' },
        { href: '/billing/service-types', label: 'Service Types', icon: 'billing' },
        { href: '/billing/monthly-entry', label: 'Monthly Entry', icon: 'billing' },
        { href: '/billing/history', label: 'Billing History', icon: 'billing' },
        { href: '/billing/report', label: 'Billing Report', icon: 'billing' },
      ],
    },
    {
      section: 'Release Management',
      items: [
        { href: '/release-dashboard', label: 'Release Dashboard', icon: 'overview' },
        { href: '/repositories', label: 'Repositories', icon: 'repositories' },
        { href: '/releases', label: 'Releases', icon: 'releases' },
        { href: '/release-board', label: 'Release Board', icon: 'releases' },
        { href: '/deployments', label: 'Deployments', icon: 'deployments' },
        { href: '/release-metrics', label: 'Release Metrics', icon: 'performance' },
        { href: '/release-calendar', label: 'Release Calendar', icon: 'releases' },
        { href: '/environments', label: 'Environments', icon: 'environments' },
        { href: '/ai', label: 'AI Assistant', icon: 'admin-tools' },
        ...(role === 'admin' ? [{ href: '/release-workflows', label: 'Workflow Config', icon: 'admin-tools' }] : []),
        ...(role === 'admin' ? [{ href: '/audit-log', label: 'Audit Log', icon: 'admin-tools' }] : []),
        ...(role === 'admin' ? [{ href: '/agent-updates', label: 'Agent Updates', icon: 'admin-tools' }] : []),
      ],
    },
    {
      section: 'System',
      items: [
        { href: '/setup', label: 'Setup Guide', icon: 'setup' },
        ...(role === 'admin' ? [{ href: '/users', label: 'Users', icon: 'users' }] : []),
        ...(role === 'admin' ? [{ href: '/access', label: 'Access Control', icon: 'access' }] : []),
        // Personal account security (passkeys, trusted devices) — per-user, not shared app config.
        { href: '/profile', label: 'My Profile', icon: 'profile' },
        // Settings available to all roles (theme); SMTP read-only for non-admin
        { href: '/settings', label: 'Settings', icon: 'settings' },
      ],
    },
  ];

  const isActiveRoute = (href) => href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={`layout shell-layout${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
      <header className="mobile-nav-header">
        <div className="brand"><Icon name="brand" size={24} /> Monitor</div>
        <button ref={mobileToggleRef} type="button" className="mobile-nav-toggle icon-button focus-ring"
          aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((open) => !open)}>
          <Icon name="menu" size={20} />
        </button>
      </header>
      {mobileNavOpen && (
        <button type="button" className="mobile-nav-backdrop focus-ring" aria-label="Dismiss navigation"
          tabIndex={-1} onClick={() => setMobileNavOpen(false)} />
      )}
      <aside ref={sidebarRef} id="primary-navigation" className="sidebar" aria-label="Main navigation"
        role={mobileNavOpen ? 'dialog' : undefined} aria-modal={mobileNavOpen ? 'true' : undefined}>
        <div className="sidebar-brand-row">
          <div className="brand"><Icon name="brand" size={24} /> Monitor</div>
          <button type="button" className="mobile-nav-close icon-button focus-ring" aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}><Icon name="close" size={20} /></button>
        </div>
        <nav aria-label="Primary">
          {navGroups.map((group, gi) => (
            <div key={group.section ?? `group-${gi}`} className="nav-group">
              {group.section && <div className="nav-section">{group.section}</div>}
              {group.items.map((n) => (
                <Link key={n.href} href={n.href} className={isActiveRoute(n.href) ? 'active' : ''}
                  aria-current={isActiveRoute(n.href) ? 'page' : undefined} onClick={() => setMobileNavOpen(false)}>
                  <span className="nav-icon"><Icon name={n.icon} /></span>
                  <span>{n.label}</span>
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
      <main className="content" aria-hidden={mobileNavOpen ? 'true' : undefined}>
        {showPasskeyNudge && pathname !== '/profile' && (
          <div className="passkey-nudge">
            <span>🔑 Set up a passkey for faster, more secure sign-in.</span>
            <div className="passkey-nudge-actions">
              <Link href="/profile" className="btn-primary passkey-nudge-link">Set up</Link>
              <button type="button" className="icon-button focus-ring" onClick={dismissPasskeyNudge} aria-label="Dismiss">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
        )}
        {children}
      </main>
      <style jsx global>{`
        .shell-layout .brand { display: flex; align-items: center; gap: 10px; }
        .shell-layout .brand svg { flex-shrink: 0; color: var(--accent); }
        .shell-layout .sidebar-brand-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .shell-layout .mobile-nav-header,
        .shell-layout .mobile-nav-toggle,
        .shell-layout .mobile-nav-close { display: none; }
        .shell-layout .sidebar .badge { margin-left: auto; }
        .shell-layout .passkey-nudge {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-md);
          padding: 10px 16px; margin-bottom: 16px; font-size: 13px;
        }
        .shell-layout .passkey-nudge-actions { display: flex; align-items: center; gap: 10px; }
        .shell-layout .passkey-nudge-link {
          display: inline-flex; align-items: center; padding: 6px 12px; font-size: 12px; font-weight: 600;
        }
        @media (max-width: 760px) {
          .shell-layout .mobile-nav-header {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--border);
          }
          .shell-layout .mobile-nav-header .brand { margin: 0; }
          .shell-layout .mobile-nav-toggle, .shell-layout .mobile-nav-close { display: inline-grid; }
          .shell-layout .sidebar {
            position: fixed; inset: 0 auto 0 0; z-index: 101; width: min(280px, 88vw);
            height: 100vh; height: 100dvh; visibility: hidden; transform: translateX(-100%);
            box-shadow: var(--shadow-md); transition: transform var(--motion-normal);
          }
          .shell-layout.mobile-nav-open .sidebar { visibility: visible; transform: translateX(0); }
          .shell-layout .mobile-nav-backdrop {
            display: block; position: fixed; inset: 0; z-index: 100; width: 100%; height: 100%;
            padding: 0; border: 0; border-radius: 0; background: rgb(0 0 0 / 55%);
          }
          .shell-layout .mobile-nav-backdrop:hover { filter: none; }
          .shell-layout .mobile-nav-backdrop:active { transform: none; }
        }
      `}</style>
    </div>
  );
}
