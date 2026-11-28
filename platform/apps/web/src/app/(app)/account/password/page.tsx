import { redirect } from 'next/navigation';
import { getMe } from '@/lib/page';
import { Notice } from '@/components/ui';
import { changePassword } from '../actions';

export const metadata = { title: 'Change password' };

// Email and password sign-in only. A temporary password set by an administrator must be changed here first.
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ next?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (me.authMode !== 'local') redirect('/today');
  return (
    <>
      <h1 className="mb-16">Change your password</h1>
      <Notice ok={sp.ok} err={sp.err} />
      {me.mustChange ? <div className="callout warn mb-16" role="note"><strong>You signed in with a temporary password.</strong> Choose your own before you carry on.</div> : null}
      <form action={changePassword.bind(null, sp.next ?? '/today')} className="card card-pad stack" style={{ maxWidth: 520 }}>
        <div className="field"><label htmlFor="current">Current password</label><input className="input" id="current" name="current" type="password" autoComplete="current-password" required /></div>
        <div className="field"><label htmlFor="next">New password</label><input className="input" id="next" name="next" type="password" autoComplete="new-password" required minLength={12} />
          <div className="help">At least 12 characters, and not your email address. A short sentence is easier to remember than a jumble.</div></div>
        <div className="field"><label htmlFor="again">New password again</label><input className="input" id="again" name="again" type="password" autoComplete="new-password" required minLength={12} /></div>
        <div><button className="btn btn-primary" type="submit">Change password</button></div>
        <p className="small muted" style={{ margin: 0 }}>Changing your password signs you out everywhere else.</p>
      </form>
    </>
  );
}
