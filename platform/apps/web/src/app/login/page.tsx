import { env } from '@/lib/env';
import { devSignIn, localSignIn } from './actions';

const PEOPLE: [string, string, string][] = [
  ['dev-vic', 'Victoria E.', 'Quality Manager · approver'],
  ['dev-tom', 'PJ Walters', 'Approver · Head of IT'],
  ['dev-sam', 'Jim Speir', 'Author'],
  ['dev-priya', 'Carrie Foreman', 'Reviewer · author'],
  ['dev-grace', 'Louise Harvey', 'Process owner'],
  ['dev-daniel', 'Daniel Greenwood', 'Employee'],
  ['dev-hannah', 'Lucy Parkin', 'System Administrator'],
  ['dev-aud', 'Fraser Scott', 'Auditor (read-only)'],
  // The rest of the seeded people, so every UAT step (docs/07) can be done through the screens.
  ['dev-omar', 'Omar Haddad', 'Reviewer · author'],
  ['dev-mia', 'Mia Santos', 'Employee · author'],
  ['dev-lena', 'Lena Novak', 'Employee'],
  ['dev-jake', 'Jake Turner', 'Employee']
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; err?: string }> }) {
  const { next = '/today', err } = await searchParams;
  const dev = env.devAuth;
  const local = env.authMode === 'local';
  return (
    <main className="content" id="main" style={{ maxWidth: 520 }}>
      <div className="card card-pad mt-24">
        <div className="brand-logo" role="img" aria-label="Katalyze Data" style={{ marginBottom: 16 }} />
        <h1>Sign in to VeQMS</h1>
        <p className="muted mt-8">{local ? 'Use the email address and password your System Administrator set up for you.' : 'Use your Microsoft 365 work account.'} Your sign-in identifies you on every record you create, review or confirm.</p>
        {err ? <div className="callout warn mt-16" role="alert"><strong>Couldn’t sign you in.</strong> <span>{err}</span></div> : null}
        {local ? (
          <form action={localSignIn} className="stack mt-16">
            <input type="hidden" name="next" value={next} />
            <div className="field"><label htmlFor="email">Email address</label><input className="input" id="email" name="email" type="email" autoComplete="username" required /></div>
            <div className="field"><label htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
            <div><button className="btn btn-primary" type="submit">Sign in</button></div>
            <p className="small muted" style={{ margin: 0 }}>Forgotten your password? Ask a System Administrator to reset it. After 5 wrong passwords an account is locked for 15 minutes.</p>
          </form>
        ) : <a className="btn btn-primary mt-16" href={`/auth/start?next=${encodeURIComponent(next)}`}>Sign in with Microsoft</a>}
        {dev ? (
          <form action={devSignIn} className="mt-24">
            <input type="hidden" name="next" value={next} />
            <fieldset>
              <legend className="label">Development only · sign in as a demo persona</legend>
              {PEOPLE.map(([id, name, role]) => (
                <label className="check" key={id}><input type="radio" name="persona" value={id} required /> {name} <span className="muted small">· {role}</span></label>
              ))}
            </fieldset>
            <button className="btn mt-16" type="submit">Continue as this persona</button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
