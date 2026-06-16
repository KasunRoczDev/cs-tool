'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getToken, setToken } from '@/lib/api';
import { getSocket } from '@/lib/socket';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/compare', label: 'Compare' },
  { href: '/alerts', label: 'Alerts' },
];

export default function Shell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  // Client-side auth guard
  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else setReady(true);
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

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">🛡️ Monitor</div>
        <nav>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={pathname === n.href ? 'active' : ''}>
              {n.label}
              {n.href === '/alerts' && alertCount > 0 && <span className="badge"> {alertCount}</span>}
            </Link>
          ))}
        </nav>
        <button className="logout" onClick={() => { setToken(null); router.push('/login'); }}>
          Log out
        </button>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
