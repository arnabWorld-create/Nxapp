'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type CurrentUser = { name: string; email: string; role: string; permissions: string[] };

const navigation = [
  { label: 'Dashboard', href: '/', section: 'Overview', permission: undefined },
  { label: 'Sales Analytics', href: '/sales-analytics', section: 'Sales', permission: undefined },
  { label: 'Statements', href: '/statements', section: 'Sales', permission: undefined },
  { label: 'Imports', href: '/imports', section: 'Sales', permission: undefined },
  { label: 'Distributors', href: '/distributors', section: 'Sales', permission: 'view_statement' },
  { label: 'Products', href: '/products', section: 'Masters', permission: 'manage_product' },
  { label: 'Users', href: '/users', section: 'Administration', permission: 'manage_user' },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('nxapp-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem('nxapp-theme', nextTheme);
  }

  useEffect(() => {
    if (pathname === '/login' || pathname === '/register') return;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (response.ok) setUser((await response.json()).user);
      })
      .catch(() => undefined);
  }, [pathname]);

  if (pathname === '/login' || pathname === '/register') return <>{children}</>;

  const visibleNavigation = navigation.filter((item) => !item.permission || user?.permissions.includes(item.permission));
  const sections = ['Overview', 'Sales', 'Masters', 'Administration'];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">N</span>
          <span className="brand-copy"><strong>NX APP</strong><small>Sales operations</small></span>
        </div>
        <nav id="primary-navigation" className="sidebar-nav" aria-label="Primary navigation">
          {sections.map((section) => {
            const links = visibleNavigation.filter((item) => item.section === section);
            if (links.length === 0) return null;
            return <div className="nav-group" key={section}>
              <p className="nav-label">{section}</p>
              {links.map((item) => <Link key={item.href} href={item.href as any} onClick={() => setMobileOpen(false)} className={`nav-link ${pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`)) ? 'active' : ''}`}><span className="nav-dot" /><span>{item.label}</span></Link>)}
            </div>;
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip"><span className="avatar">{user?.name?.charAt(0).toUpperCase() || 'U'}</span><span className="user-copy"><strong>{user?.name || 'Loading account'}</strong><small>{user?.role || 'Authenticated user'}</small></span></div>
          <div className="sidebar-footer-actions"><button className="sign-out" onClick={signOut}>Sign out</button><button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}><span aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span>{theme === 'dark' ? 'Light' : 'Dark'}</button></div>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className="app-content">
        <header className="mobile-header"><button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded={mobileOpen}><span aria-hidden="true">☰</span></button><span className="mobile-brand"><strong>NX APP</strong><small>Sales operations</small></span><button className="theme-toggle mobile-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}><span aria-hidden="true">{theme === 'dark' ? '☀' : '◐'}</span></button></header>
        {children}
      </div>
    </div>
  );
}