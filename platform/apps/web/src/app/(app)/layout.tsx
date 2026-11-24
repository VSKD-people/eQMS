import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { currentPath, getMe, has } from '@/lib/page';
import { Icon } from '@/components/Icon';

// Every page in this group needs a signed-in user. The API checks permissions again on every call.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const path = await currentPath();
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(path)}`);
  const me = await getMe();
  const nav: [string, string, string, boolean][] = [
    ['/today', 'Today', 'home', true],
    ['/documents', 'Documents', 'doc', true],
    ['/training', 'Training', 'training', true],
    ['/approvals', 'Approvals and DocuSign', 'sign', has(me, 'approvals.view')],
    ['/quality', 'Quality', 'quality', true],
    ['/admin', 'Administration', 'admin', has(me, 'audit.read') || has(me, 'admin.settings') || has(me, 'admin.users')]
  ];
  const active = (href: string) => path === href || path.startsWith(href + '/') || path.startsWith(href + '?');
  return (
    <div className="app rail-open">
      <nav className="rail" aria-label="Main">
        {nav.filter((n) => n[3]).map(([href, label, icon]) => (
          <a key={href} className={`rail-item ${active(href) ? 'active' : ''}`} href={href} aria-current={active(href) ? 'page' : undefined}>
            <Icon name={icon} /><span className="rail-text">{label}</span>
          </a>
        ))}
        <div className="rail-spacer" />
        <a className="rail-item" href="/auth/logout"><Icon name="out" /><span className="rail-text">Sign out</span></a>
      </nav>
      <div className="main-col">
        <header className="topbar">
          <a className="brand-logo" href="/today" aria-label="Katalyze Data · VeQMS home" />
          <div className="topbar-spacer" />
          <span className="small muted" style={{ textAlign: 'right' }}>{me.user.name}<br />{me.tenant.name}</span>
          <span className="avatar" aria-hidden="true">{me.user.initials}</span>
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </div>
      <nav className="tabbar" aria-label="Mobile">
        {nav.filter((n) => n[3]).slice(0, 5).map(([href, label, icon]) => (
          <a key={href} className={active(href) ? 'active' : ''} href={href}><Icon name={icon} /><span>{label.split(' ')[0]}</span></a>
        ))}
      </nav>
    </div>
  );
}
