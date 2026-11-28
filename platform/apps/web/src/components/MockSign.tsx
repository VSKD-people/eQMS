import type { AgreementSummary, Me } from '@/lib/types';
import { mockDecline, mockSign } from '@/app/(app)/approvals/actions';

// Shown only when Adobe Sign isn't connected (ADOBE_SIGN_MODE=mock: development and pilot). It stands in for the
// Adobe Sign email and signing page; the signature is recorded as simulated, not Part 11. In live mode signers sign
// in Adobe Sign itself and the app shows status only.
export function MockSignPanel({ e, me, back }: { e: AgreementSummary; me: Me; back: string }) {
  if (me.esignMode !== 'mock' || e.status !== 'sent') return null;
  const mine = e.signers.find((s) => s.userId === me.user.id && s.status === 'sent');
  if (!mine) return null;
  return (
    <section className="card card-pad mb-16" aria-labelledby={`mock-${e.id}`} style={{ borderStyle: 'dashed' }}>
      <h2 id={`mock-${e.id}`} className="label mb-8">Sign (simulated: Adobe Sign isn’t connected)</h2>
      <p className="small muted">This stands in for Adobe Sign until it is connected. Your signature is recorded as <b>simulated, not Part 11</b>. With Adobe Sign connected you sign in Adobe Sign and this panel doesn’t appear.</p>
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
