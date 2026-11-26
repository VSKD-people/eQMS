import type { AgreementSummary, Me } from '@/lib/types';
import { mockDecline, mockSign } from '@/app/(app)/approvals/actions';

// Shown only when the API runs Adobe Sign in mock mode (development). It stands in for the Adobe Sign email and
// signing page. In live mode signers sign in Adobe Sign itself and the app shows status only.
export function MockSignPanel({ e, me, back }: { e: AgreementSummary; me: Me; back: string }) {
  if (me.esignMode !== 'mock' || e.status !== 'sent') return null;
  const mine = e.signers.find((s) => s.userId === me.user.id && s.status === 'sent');
  if (!mine) return null;
  return (
    <section className="card card-pad mb-16" aria-labelledby={`mock-${e.id}`} style={{ borderStyle: 'dashed' }}>
      <h2 id={`mock-${e.id}`} className="label mb-8">Sign in Adobe Sign (mock)</h2>
      <p className="small muted">Development only. Adobe Sign is in mock mode, so this panel stands in for the Adobe Sign email. In live mode you sign in Adobe Sign and this panel does not appear.</p>
      <p className="small">You sign as <b>{mine.name}</b> · {mine.roleLabel} · signature meaning: <b>{mine.meaning}</b></p>
      <div className="btn-row">
        <form action={mockSign.bind(null, e.id, back)}><button className="btn btn-primary" type="submit">Sign ({mine.meaning})</button></form>
      </div>
      <details className="mt-16"><summary className="small">Decline instead</summary>
        <form action={mockDecline.bind(null, e.id, back)} className="stack mt-8">
          <div className="field"><label htmlFor={`decl-${e.id}`}>Reason</label><textarea className="textarea" id={`decl-${e.id}`} name="reason" required /></div>
          <button className="btn btn-danger" type="submit">Decline</button>
        </form>
      </details>
    </section>
  );
}
