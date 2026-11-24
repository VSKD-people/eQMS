import { getMe, load } from '@/lib/page';
import type { Task } from '@/lib/types';
import { daysFromNow } from '@/lib/format';
import { DueChip, Empty } from '@/components/ui';

export const metadata = { title: 'Today' };

const LABEL: Record<string, [string, string]> = {
  'esign': ['Sign in Adobe Sign', 'Open'],
  'send-approval': ['Verify and send · Adobe Sign', 'Verify and send'],
  training: ['Read and understood', 'Start training'],
  'review-doc': ['Review · Document', 'Review'],
  author: ['Draft · Document', 'Continue draft'],
  resubmit: ['Sent back · Document', 'Revise draft'],
  effectiveness: ['Effectiveness check · CAPA', 'Record result'],
  'qe-assess': ['Assess · Quality event', 'Open'],
  fyi: ['FYI · You sign in Adobe Sign later', 'View']
};

// Where each task's action lives.
function href(t: Task): string {
  if (t.kind === 'training' && t.ref) return `/training/${t.ref}`;
  // Signing tasks carry the agreement ID in ref. Closures are signed from the agreement page (open to the signer).
  if (t.kind === 'esign' && t.recordType !== 'document' && t.ref) return `/approvals/${t.ref}`;
  if (t.recordType === 'capa') return `/quality/capas/${t.recordNumber}`;
  if (t.recordType === 'quality_event') return `/quality/events/${t.recordNumber}`;
  if (t.kind === 'send-approval') return `/documents/${t.recordNumber}/send`;
  if (t.kind === 'esign') return `/documents/${t.recordNumber}?tab=approval`;
  return `/documents/${t.recordNumber}`;
}

export default async function TodayPage() {
  const [tasks, me] = await Promise.all([load<Task[]>('/tasks'), getMe()]);
  const signNote = me.esignMode === 'mock' ? 'Adobe Sign is in mock mode: open the record to sign.' : 'Sign in Adobe Sign: use the link in your Adobe Sign email.';
  const groups: [string, Task[]][] = [
    ['Overdue', tasks.filter((t) => !t.fyi && (daysFromNow(t.dueAt) ?? 1) < 0)],
    ['Next 7 days', tasks.filter((t) => !t.fyi && (daysFromNow(t.dueAt) ?? 99) >= 0 && (daysFromNow(t.dueAt) ?? 99) <= 7)],
    ['Upcoming', tasks.filter((t) => t.fyi || daysFromNow(t.dueAt) === null || (daysFromNow(t.dueAt) ?? 0) > 7)]
  ];
  const overdue = groups[0]![1].length;
  return (
    <>
      <div className="page-head"><div><h1 className="display">Today</h1>
        <div className="sub">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' }).format(new Date())} · {overdue} overdue · {groups[1]![1].length} due in the next 7 days</div></div></div>
      {!tasks.length ? <Empty title="You’re all caught up" text="New tasks appear here as soon as they’re assigned to you." /> : null}
      {groups.filter(([, list]) => list.length).map(([label, list]) => (
        <section key={label} aria-label={label}>
          <h2 className={`group-label ${label === 'Overdue' ? 'overdue' : ''}`}>{label} · {list.length}</h2>
          {list.map((t) => {
            const [kicker, action] = LABEL[t.kind] ?? ['Task', 'Open'];
            return (
              <div className="task-card" key={t.id}>
                <div className="tc-body">
                  <div className="tc-kicker"><span>{kicker}</span>{t.fyi ? null : <DueChip iso={t.dueAt} />}</div>
                  <div className="tc-title">{t.title}</div>
                  {t.kind === 'esign' ? <div className="small muted">{signNote} {t.note ?? ''}</div> : t.note ? <div className="small muted">{t.note}</div> : null}
                </div>
                <a className={`btn ${t.fyi ? '' : 'btn-primary'}`} href={href(t)}>{action}</a>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
