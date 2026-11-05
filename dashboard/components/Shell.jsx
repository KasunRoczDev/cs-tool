'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, getToken, setToken, setRole, getRole } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { navigationGroups, getPageContext } from '@/lib/navigation';
import { useDashboard } from '@/lib/useDashboard';
import Breadcrumbs from './Breadcrumbs';
import Icon from './Icon';

const PASSKEY_NUDGE_DISMISSED_KEY = 'passkeyNudgeDismissed';
const workspaceIcons = {
  Home: 'overview', Observe: 'monitoring', Secure: 'security',
  Deliver: 'deployments', FinOps: 'billing', Admin: 'settings',
};

// Search is deliberately limited to permitted destinations from the navigation contract.
function NavigationSearch({ groups, onNavigate }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const resultsRef = useRef(null);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = groups.flatMap(({ section, items }) => items.map((item) => ({ ...item, workspace: section })))
    .filter((item) => words.every((word) => `${item.label} ${item.workspace} ${item.description} ${item.href}`.toLowerCase().includes(word)));
  const selectedIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  useEffect(() => {
    if (open) resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, selectedIndex, query]);

  const select = (item) => {
    setOpen(false);
    setQuery('');
    onNavigate(item.href);
  };

  const onKeyDown = (event) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(open ? (selectedIndex + step + results.length) % Math.max(1, results.length)
        : event.key === 'ArrowDown' ? 0 : Math.max(0, results.length - 1));
    } else if (open && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, results.length - 1));
    } else if (open && event.key === 'Enter' && results[selectedIndex]) {
      event.preventDefault();
      select(results[selectedIndex]);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="shell-search" role="search" aria-label="Navigation"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label className="shell-sr-only" htmlFor="shell-navigation-search">Search pages</label>
      <Icon name="search" size={18} />
      <input id="shell-navigation-search" type="search" role="combobox" autoComplete="off" spellCheck={false}
        placeholder="Search pages…" value={query} aria-expanded={open} aria-controls={open ? 'shell-search-results' : undefined}
        aria-autocomplete="list" aria-activedescendant={open && results.length ? `shell-search-option-${selectedIndex}` : undefined}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKeyDown}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} />
      {open && (
        <div className="shell-search-popover">
          <ul id="shell-search-results" ref={resultsRef} role="listbox" aria-label="Pages">
            {results.map((item, index) => (
              <li id={`shell-search-option-${index}`} key={item.href} role="option" aria-selected={index === selectedIndex}
                onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)}>
                <Icon name={item.icon} size={18} />
                <span className="shell-search-result-copy"><strong>{item.label}</strong><span>{item.workspace}</span></span>
                <Icon name="chevron" size={14} />
              </li>
            ))}
          </ul>
          <p className="shell-search-help" role="status">
            {results.length ? `${results.length} pages · Use arrow keys to browse, Enter to open.` : 'No pages found. Try another page or workspace name.'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function Shell({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggleTheme } = useDashboard();
  const [ready, setReady] = useState(false);
  const [role, setRoleState] = useState(null);
  const [alertCount, setAlertCount] = useState(0);
  const [showPasskeyNudge, setShowPasskeyNudge] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const sidebarRef = useRef(null);
  const mobileToggleRef = useRef(null);
  const bodyRef = useRef(null);
  const mainRef = useRef(null);
  const context = getPageContext(pathname);
  const workspace = context?.workspace;
  const currentDestination = context?.parent?.href || context?.href;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!workspace) return;
    const destinationGroup = navigationGroups(role).find((group) => group.items.some((item) => item.href === currentDestination));
    setExpandedGroups((previous) => ({
      ...previous, [workspace]: true, ...(destinationGroup ? { [destinationGroup.section]: true } : {}),
    }));
  }, [pathname, workspace, currentDestination, role]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const sidebar = sidebarRef.current;
    const mobileToggle = mobileToggleRef.current;
    const body = bodyRef.current;
    const main = mainRef.current;
    const previousOverflow = document.body.style.overflow;
    const desktop = window.matchMedia('(min-width: 761px)');
    document.body.style.overflow = 'hidden';
    if (body) body.inert = true;
    const controls = () => Array.from(sidebar?.querySelectorAll('a[href], button:not(:disabled)') || [])
      .filter((control) => control.getClientRects().length > 0);
    controls()[0]?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
      }
      if (event.key !== 'Tab') return;
      const focusable = controls();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onFocus = (event) => { if (!sidebar?.contains(event.target)) controls()[0]?.focus(); };
    const onResize = () => { if (desktop.matches) setMobileNavOpen(false); };
    onResize();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    desktop.addEventListener('change', onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (body) body.inert = false;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocus);
      desktop.removeEventListener('change', onResize);
      if (mobileToggle?.getClientRects().length) mobileToggle.focus();
      else if (sidebar?.contains(document.activeElement)) main?.focus();
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

  const groups = navigationGroups(role);
  const breadcrumbs = context ? [
    { label: context.workspace },
    ...(context.parent ? [{ label: context.parent.title, href: context.parent.href }] : []),
    { label: context.title },
  ] : [{ label: 'Workspace' }];

  return (
    <div className={`layout shell-layout${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
      <a className="shell-skip-link" href="#shell-main">Skip to content</a>
      {mobileNavOpen && (
        <button type="button" className="mobile-nav-backdrop" aria-label="Dismiss navigation"
          tabIndex={-1} onClick={() => setMobileNavOpen(false)} />
      )}
      <aside ref={sidebarRef} id="primary-navigation" className="sidebar" aria-label="Workspaces"
        role={mobileNavOpen ? 'dialog' : undefined} aria-modal={mobileNavOpen ? 'true' : undefined}>
        <div className="sidebar-brand-row">
          <Link href="/" className="brand" aria-label="Monitor overview" onClick={() => setMobileNavOpen(false)}>
            <Icon name="brand" size={26} /> Monitor
          </Link>
          <button type="button" className="mobile-nav-close icon-button" aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}><Icon name="close" size={20} /></button>
        </div>
        <nav className="shell-workspaces" aria-label="Primary">
          {groups.map((group) => {
            const expanded = expandedGroups[group.section] ?? (group.section === 'Home' || group.section === workspace);
            const groupId = `workspace-${group.section.toLowerCase()}`;
            return (
              <div key={group.section} className={`nav-group${workspace === group.section ? ' nav-group-current' : ''}`}>
                <button type="button" className="shell-workspace-toggle" aria-expanded={expanded} aria-controls={groupId}
                  onClick={() => setExpandedGroups((previous) => ({ ...previous, [group.section]: !expanded }))}>
                  <Icon name={workspaceIcons[group.section]} size={18} />
                  <span>{group.section}</span>
                  <span className="shell-workspace-chevron"><Icon name="chevron" size={14} /></span>
                </button>
                <div id={groupId} className="shell-workspace-links" hidden={!expanded}>
                  {group.items.map((item) => {
                    const active = currentDestination === item.href;
                    return (
                      <Link key={item.href} href={item.href} className={active ? 'active' : ''}
                        aria-current={active ? 'page' : undefined} onClick={() => setMobileNavOpen(false)}>
                        <span className="nav-icon"><Icon name={item.icon} size={16} /></span>
                        <span className="shell-nav-label">{item.label}</span>
                        {item.href === '/alerts' && alertCount > 0 && (
                          <span className="shell-alert-badge" aria-label={`${alertCount} active alerts`}>{alertCount}</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <footer className="shell-account">
          <Link href="/setup" className="shell-help" onClick={() => setMobileNavOpen(false)}>
            <Icon name="setup" size={16} /> Setup guide
          </Link>
          <div className="shell-account-row">
            <Link href="/profile" className="shell-profile" onClick={() => setMobileNavOpen(false)}>
              <Icon name="profile" size={20} />
              <span>My profile<span className="shell-role">{role}</span></span>
            </Link>
            <button type="button" className="icon-button" aria-label="Log out" title="Log out"
              onClick={() => { setToken(null); setRole(null); router.push('/login'); }}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </footer>
      </aside>
      <div ref={bodyRef} className="shell-body" aria-hidden={mobileNavOpen ? 'true' : undefined}>
        <header className="shell-topbar">
          <button ref={mobileToggleRef} type="button" className="mobile-nav-toggle icon-button"
            aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}><Icon name="menu" size={20} /></button>
          <div className="shell-page-context"><Breadcrumbs items={breadcrumbs} /></div>
          <button type="button" className="icon-button shell-theme-toggle" onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={18} />
          </button>
          <NavigationSearch key={pathname} groups={groups} onNavigate={(href) => router.push(href)} />
        </header>
        <main ref={mainRef} id="shell-main" className="content" tabIndex={-1}>
          {showPasskeyNudge && pathname !== '/profile' && (
            <div className="passkey-nudge">
              <span className="shell-passkey-copy"><Icon name="access" size={18} /> Set up a passkey for faster, more secure sign-in.</span>
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
      </div>
    </div>
  );
}
