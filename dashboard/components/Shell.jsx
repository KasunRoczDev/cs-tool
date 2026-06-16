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

  const nav = [
    { href: '/', label: 'Overview' },
    { href: '/compare', label: 'Compare' },
    { href: '/alerts', label: 'Alerts' },
  ];
  if (role === 'admin') nav.push({ href: '/users', label: 'Users' });

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">🛡️ Monitor</div>
        <nav>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              {n.label}
              {n.href === '/alerts' && alertCount > 0 && <span className="badge"> {alertCount}</span>}
            </Link>
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
