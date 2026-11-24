import { redirect } from 'next/navigation';
import { getMe, has, load } from '@/lib/page';
import type { AuditEntry, Settings, SharePointOverview, UserRow } from '@/lib/types';
import { MONTHS, fmtUtc, qs } from '@/lib/format';
import { Chip, Empty, Notice, Tabs } from '@/components/ui';
import { endSessions, republish, resolveAlert, saveRoles, saveSettings, saveStatus, simulateOutsideEdit, syncNow } from './actions';

export const metadata = { title: 'Administration' };

type SP = { tab?: string; objectType?: string; objectId?: string; verify?: string; ok?: string; err?: string };

// The record types the API writes to the audit trail.
const OBJECT_TYPES = ['Document', 'CAPA', 'Quality event', 'Training record', 'Training', 'User', 'Group', 'Settings', 'Report', 'Audit trail'];

export default async function AdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const me = await getMe();
  const tabs: [string, string][] = [];
  if (has(me, 'audit.read')) tabs.push(['audit', 'Audit trail']);
  if (has(me, 'audit.read')) tabs.push(['sharepoint', 'SharePoint']);
  if (has(me, 'admin.settings')) tabs.push(['settings', 'Settings']);
  if (has(me, 'admin.users') || has(me, 'audit.read')) tabs.push(['users', 'Users']);
  if (!tabs.length) redirect('/today');
  const tab = tabs.some(([t]) => t === sp.tab) ? sp.tab! : tabs[0]![0];
  return (
    <>
      <div className="page-head"><div><h1>Administration</h1><div className="sub">Audit trail, SharePoint, settings and users. Users and groups come from Microsoft Entra ID.</div></div></div>
      <Tabs base="/admin" current={tab} tabs={tabs} />
      <Notice ok={sp.ok} err={sp.err} />
      {tab === 'audit' ? <AuditTab sp={sp} /> : tab === 'sharepoint' ? <SharePointTab canSync={has(me, 'admin.settings')} canResolve={has(me, 'integrity.resolve')} />
        : tab === 'settings' ? <SettingsTab /> : <UsersTab canManage={has(me, 'admin.users')} myId={me.user.id} />}
    </>
  );
}

async function AuditTab({ sp }: { sp: SP }) {
  const f = { objectType: OBJECT_TYPES.includes(sp.objectType ?? '') ? sp.objectType! : '', objectId: (sp.objectId ?? '').slice(0, 100) };
  const [rows, check] = await Promise.all([
    load<AuditEntry[]>(`/audit${qs({ ...f, limit: 200 })}`),
    sp.verify === '1' ? load<{ ok: boolean; entries: number; brokenAt: number | null; anchor: { anchored: boolean; seq: number | null; at: string | null; matches: boolean | null; problem: string | null } }>('/audit/verify') : Promise.resolve(null)
  ]);
  return (
    <>
      <form method="get" className="toolbar" role="search">
        <input type="hidden" name="tab" value="audit" />
        <label htmlFor="f-type" className="sr-only">Record type</label>
        <select className="select" id="f-type" name="objectType" defaultValue={f.objectType}><option value="">Any record type</option>{OBJECT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select>
        <label htmlFor="f-id" className="sr-only">Record ID</label>
        <input className="input" id="f-id" name="objectId" defaultValue={f.objectId} placeholder="Record ID" />
        <button className="btn" type="submit">Filter</button>
        <span style={{ flex: 1 }} />
        <a className="btn" href={`/admin${qs({ tab: 'audit', ...f, verify: 1 })}`}>Verify the chain</a>
      </form>
      {check ? (check.ok
        ? <div className="callout ok mb-16" role="status"><strong>Chain verified.</strong> {check.entries} entries checked; every hash matches the one before it.
            {' '}{check.anchor.anchored ? `The latest anchor (entry ${check.anchor.seq}, ${fmtUtc(check.anchor.at)}) matches.` : 'No anchor has been written yet.'}</div>
        : <div className="callout warn mb-16" role="alert"><strong>{check.brokenAt ? `The chain is broken at entry ${check.brokenAt}.` : 'The chain does not match its anchor.'}</strong>
            {' '}{check.anchor.problem ?? ''} Treat this as a data-integrity incident and tell the Quality Manager now.</div>) : null}
      {rows.length ? (
        <div className="table-wrap"><table className="t"><caption className="sr-only">Audit trail, newest first</caption>
          <thead><tr><th scope="col">#</th><th scope="col">When (UTC)</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Summary</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.seq}><td>{a.seq}</td><td className="nowrap">{fmtUtc(a.at)}</td><td>{a.actor}</td><td>{a.action}</td>
              <td className="small">{a.objectType.replace(/_/g, ' ')}<div className="muted"><code>{a.objectId}</code></div></td><td className="small">{a.summary}</td></tr>
          ))}</tbody></table></div>
      ) : <Empty title="No entries match" />}
      <p className="small muted mt-16">Showing up to 200 entries. The audit trail is insert-only; nobody can edit or delete it.</p>
    </>
  );
}

const ALERT_KIND: Record<string, string> = { 'outside-change': 'Changed outside VeQMS', missing: 'File missing', 'hash-mismatch': 'Hash mismatch', 'publish-failed': 'Publish failed' };

async function SharePointTab({ canSync, canResolve }: { canSync: boolean; canResolve: boolean }) {
  const o = await load<SharePointOverview>('/sharepoint');
  const run = (lib: string) => o.runs.find((r) => r.library === lib);
  const open = o.alerts.filter((a) => !a.resolvedAt);
  return (
    <div className="stack">
      {o.mode === 'mock' ? <div className="callout mb-8"><strong>Mock SharePoint.</strong> A local folder stands in for both libraries, and drafts are written in VeQMS instead of Word. Development and UAT only.</div> : null}
      <div className="card card-pad">
        <div className="spread mb-8"><h2 className="label" style={{ margin: 0 }}>Libraries</h2>
          {canSync ? <form action={syncNow}><button className="btn btn-sm" type="submit">Sync now</button></form> : null}</div>
        <div className="table-wrap"><table className="t"><caption className="sr-only">Last sync of each library</caption>
          <thead><tr><th scope="col">Library</th><th scope="col">Last sync (UTC)</th><th scope="col">Outcome</th><th scope="col">Changes</th><th scope="col">Alerts</th></tr></thead>
          <tbody>{(['drafts', 'controlled'] as const).map((lib) => { const r = run(lib); return (
            <tr key={lib}><td>{lib === 'drafts' ? 'Drafts (Word files)' : 'Controlled (published PDFs)'}</td><td>{r ? fmtUtc(r.finishedAt ?? r.startedAt) : 'Not yet'}</td>
              <td>{r ? <Chip text={r.outcome === 'ok' ? 'OK' : r.outcome === 'failed' ? 'Failed' : 'Running'} /> : '—'}{r?.error ? <div className="small muted">{r.error}</div> : null}</td>
              <td>{r?.changes ?? '—'}</td><td>{r?.alerts ?? '—'}</td></tr>); })}</tbody></table></div>
        <p className="small muted mt-8" style={{ marginBottom: 0 }}>The sync runs every 15 minutes. Only VeQMS writes to the controlled library; any other change raises an integrity alert. Every night each published file is hashed again and compared with its locked PDF.</p>
      </div>

      <div className="card card-pad">
        <h2 className="label">Integrity alerts {open.length ? <Chip text={`${open.length} open`} cls="chip-overdue" /> : null}</h2>
        {o.alerts.length ? o.alerts.map((a) => (
          <div key={a.id} className={`callout ${a.resolvedAt ? '' : 'warn'} mb-8`} role={a.resolvedAt ? undefined : 'alert'}>
            <strong>{ALERT_KIND[a.kind] ?? a.kind}{a.document ? ` · ${a.document}${a.version ? ' v' + a.version : ''}` : ''}</strong> <span className="small muted">{fmtUtc(a.raisedAt)}</span>
            <p className="small" style={{ margin: '4px 0 0' }}>{a.detail}</p>
            {a.resolvedAt ? <p className="small muted" style={{ margin: '4px 0 0' }}>Resolved by {a.resolvedBy} ({fmtUtc(a.resolvedAt)}): {a.resolution}</p>
              : canResolve ? (
                <details className="mt-8"><summary className="btn-link" style={{ padding: 0 }}>Resolve</summary>
                  <form action={resolveAlert.bind(null, a.id)} className="mt-8">
                    <div className="field"><label htmlFor={`res-${a.id}`}>What was found and done (required)</label><textarea className="textarea" id={`res-${a.id}`} name="note" required minLength={10} /></div>
                    <button className="btn btn-sm mt-8" type="submit">Mark resolved</button>
                  </form></details>) : null}
          </div>)) : <Empty title="No integrity alerts" />}
      </div>

      <div className="card card-pad">
        <h2 className="label">Publishing to the controlled library</h2>
        {o.publishing.length ? (
          <div className="table-wrap"><table className="t"><caption className="sr-only">Published versions</caption>
            <thead><tr><th scope="col">Document</th><th scope="col">Status</th><th scope="col">Published (UTC)</th><th scope="col">File</th></tr></thead>
            <tbody>{o.publishing.map((p) => (
              <tr key={p.versionId}><td>{p.number} v{p.version}</td>
                <td><Chip text={p.status === 'pending' ? 'Waiting' : p.status === 'published' ? 'Published' : p.status === 'superseded' ? 'Marked superseded' : 'Failed'} />
                  {p.error ? <div className="small muted">{p.attempts} attempts: {p.error}</div> : null}
                  {p.status === 'failed' && canResolve ? <form action={republish.bind(null, p.versionId)}><button className="btn btn-sm mt-8" type="submit">Publish again</button></form> : null}</td>
                <td>{p.publishedAt ? fmtUtc(p.publishedAt) : '—'}</td>
                <td className="small">{p.webUrl?.startsWith('https://') ? <a href={p.webUrl} target="_blank" rel="noreferrer">Open in SharePoint</a> : p.webUrl ? <span className="muted">{decodeURIComponent(p.webUrl.split('/').pop() ?? '')} (mock)</span> : '—'}</td></tr>
            ))}</tbody></table></div>
        ) : <Empty title="Nothing published yet" />}
      </div>

      {o.mode === 'mock' && canSync ? (
        <form action={simulateOutsideEdit} className="card card-pad">
          <h2 className="label">Simulate an outside edit (mock only)</h2>
          <p className="small muted">Changes the published file of a document’s effective version as if someone edited it in SharePoint. The next sync raises an integrity alert.</p>
          <div className="row-wrap"><label htmlFor="sim-n" className="sr-only">Document number</label><input className="input" id="sim-n" name="number" placeholder="Document number, e.g. VP-001" required pattern="[A-Z]+-[0-9]+" style={{ maxWidth: 260 }} />
            <button className="btn" type="submit">Edit it outside VeQMS</button></div>
        </form>) : null}
    </div>
  );
}

async function SettingsTab() {
  const s = await load<Settings>('/settings');
  return (
    <form action={saveSettings} className="card card-pad stack" style={{ maxWidth: 720 }}>
      <h2 className="label">Adobe Sign allowance</h2>
      <div className="grid-3">
        <div className="field"><label htmlFor="s-allow">Adobe Sign transactions per year</label><input className="input" id="s-allow" name="signingAllowance" inputMode="numeric" defaultValue={s.signingAllowance} required /></div>
        <div className="field"><label htmlFor="s-month">Year starts in</label>
          <select className="select" id="s-month" name="allowanceYearStartMonth" defaultValue={String(s.allowanceYearStartMonth)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
        <div className="field"><label htmlFor="s-warn">Warn when this many are left</label><input className="input" id="s-warn" name="allowanceWarnAt" inputMode="numeric" defaultValue={s.allowanceWarnAt} required /></div>
      </div>
      <h2 className="label mt-16">Training</h2>
      <div className="field"><label htmlFor="s-ack">Read-and-understood statement</label>
        <input className="input" id="s-ack" name="ackStatement" defaultValue={s.ackStatement} required />
        <div className="help">Must include {'{doc}'} and {'{version}'}. Changes apply to records made from now on.</div></div>
      <div className="grid-2">
        <div className="field"><label htmlFor="s-rem">Reminder days before due</label><input className="input" id="s-rem" name="reminderDays" defaultValue={s.reminderDays.join(', ')} />
          <div className="help">Comma-separated, for example 7, 3, 1.</div></div>
        <div className="field"><label htmlFor="s-rep">Repeat overdue reminders every (days)</label><input className="input" id="s-rep" name="overdueRepeatDays" inputMode="numeric" defaultValue={s.overdueRepeatDays} required /></div>
      </div>
      <div><button className="btn btn-primary" type="submit">Save settings</button></div>
      <p className="small muted" style={{ margin: 0 }}>Every change is written to the audit trail with the old and new values.</p>
    </form>
  );
}

const ROLE_LABELS: [string, string][] = [['admin', 'System Administrator'], ['qm', 'Quality Manager'], ['author', 'Author'], ['reviewer', 'Reviewer'],
  ['approver', 'Approver'], ['process', 'Process owner'], ['employee', 'Employee'], ['auditor', 'Auditor (read-only)']];

async function UsersTab({ canManage, myId }: { canManage: boolean; myId: string }) {
  const users = await load<UserRow[]>('/users');
  return (
    <>
      <div className="callout plain mb-16">People, groups and leavers come from Microsoft Entra ID through SCIM provisioning. Roles are granted here by a System Administrator.
        A System Administrator can’t also be an Approver or Quality Manager, and nobody can change their own access.</div>
      {users.length ? (
        <div className="table-wrap"><table className="t"><caption className="sr-only">Users</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Job title</th><th scope="col">Roles</th><th scope="col">Groups</th><th scope="col">Status</th>{canManage ? <th scope="col">Manage</th> : null}</tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}><td><a href={`/training/records${qs({ userId: u.id })}`}>{u.name}</a></td><td className="small">{u.email}</td><td className="small">{u.jobTitle ?? '—'}</td>
              <td className="small">{u.roles.join(', ')}</td><td className="small">{u.groups.join(', ') || '—'}</td><td><Chip text={u.status} cls={u.status === 'active' ? 'chip-done' : 'chip-outline'} /></td>
              {canManage ? <td>{u.id === myId ? <span className="small muted">You</span> : (
                <details><summary className="small">Change access</summary>
                  <form action={saveRoles.bind(null, u.id)} className="stack mt-16">
                    <fieldset><legend className="small">Roles</legend>
                      {ROLE_LABELS.map(([r, label]) => <label key={r} className="check small"><input type="checkbox" name="roles" value={r} defaultChecked={u.roles.includes(r as UserRow['roles'][number])} /> {label}</label>)}</fieldset>
                    <div className="field"><label className="small" htmlFor={`rr-${u.id}`}>Reason</label><input className="input" id={`rr-${u.id}`} name="reason" required minLength={5} /></div>
                    <div><button className="btn btn-primary" type="submit">Save roles</button></div>
                  </form>
                  <form action={saveStatus.bind(null, u.id)} className="stack mt-16">
                    <div className="field"><label className="small" htmlFor={`st-${u.id}`}>Access</label>
                      <select className="select" id={`st-${u.id}`} name="status" defaultValue={u.status}><option value="active">Active</option><option value="revoked">Revoked</option><option value="left">Left the organisation</option></select></div>
                    <div className="field"><label className="small" htmlFor={`sr-${u.id}`}>Reason</label><input className="input" id={`sr-${u.id}`} name="reason" required minLength={5} /></div>
                    <div><button className="btn" type="submit">Save access</button></div>
                  </form>
                  <form action={endSessions.bind(null, u.id)} className="mt-16"><button className="btn" type="submit">End all sessions now</button></form>
                </details>)}</td> : null}</tr>
          ))}</tbody></table></div>
      ) : <Empty title="No users yet" text="Users appear once Entra ID provisioning has run." />}
    </>
  );
}
