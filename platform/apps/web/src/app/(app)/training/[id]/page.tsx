import { getMe, load, loadOrNull } from '@/lib/page';
import type { DocumentDetail, TrainingRecord } from '@/lib/types';
import { DueChip, Notice } from '@/components/ui';
import { confirmTraining } from '../actions';

export const metadata = { title: 'Read and understood' };

export default async function ConfirmTrainingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  const { open } = await load<{ open: TrainingRecord[] }>('/training/my');
  const r = open.find((x) => x.id === id);
  if (!r) {
    return (
      <div className="card card-pad">
        <h1>Nothing to confirm</h1>
        <p className="muted">This training item isn’t open for you. It may already be complete, or allocated to someone else. Only the trainee can confirm their own record.</p>
        <a className="btn" href="/training">Back to Training</a>
      </div>
    );
  }
  const n = encodeURIComponent(r.documentNumber);
  const [doc, quiz] = await Promise.all([
    loadOrNull<DocumentDetail>(`/documents/${n}`),
    loadOrNull<{ questions: { q: string; options: string[] }[] }>(`/documents/${n}/quiz`)
  ]);
  const questions = quiz?.questions ?? [];
  const pdfHref = `/files/documents/${n}/pdf?version=${encodeURIComponent(r.version)}`;
  // The text on screen is only shown when it is the version being trained on; otherwise the trainee reads the PDF.
  const showText = !!doc && doc.current.version === r.version;
  const statement = `I confirm I have read and understood ${r.documentNumber}, version ${r.version}`;
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/training">Training</a><span>/</span><span>{r.documentNumber} v{r.version}</span></nav>
      <div className="page-head"><div><h1>{r.documentNumber} {r.title} v{r.version}</h1>
        <div className="sub row-wrap">Read and understood · {r.allocReason} <DueChip iso={r.dueAt} /></div></div></div>
      <Notice err={sp.err} />
      <form action={confirmTraining.bind(null, r.id, questions.length)} className="stack">
        <section className="card card-pad" aria-labelledby="read-h">
          <div className="spread mb-8"><h2 id="read-h" className="label">1 · Read</h2><a className="btn btn-sm" href={pdfHref} target="_blank" rel="noopener">Open PDF of v{r.version}</a></div>
          {showText && doc ? (
            <div className="viewer" style={{ maxHeight: '52vh' }} tabIndex={0} aria-label="Document text">
              <div className="page" style={{ minHeight: 0 }}>
                <h2>{doc.number} {doc.title}</h2>
                <div className="doc-meta"><span>Version {r.version}</span><span>{doc.classification.toUpperCase()}</span></div>
                {doc.current.content.map((b, i) => (b.t === 'h' ? <h3 key={i}>{b.x}</h3> : <p key={i}>{b.x}</p>))}
              </div>
            </div>
          ) : (
            <p className="muted">Open the PDF of version {r.version} and read it in full before you confirm.</p>
          )}
        </section>
        {questions.length ? (
          <section className="card card-pad" aria-labelledby="quiz-h">
            <h2 id="quiz-h" className="label mb-8">2 · Knowledge check</h2>
            {questions.map((q, i) => (
              <fieldset className="quiz-q" key={i}>
                <legend style={{ fontSize: 15 }}>{i + 1}. {q.q}</legend>
                {q.options.map((o, j) => <label className="check" key={j}><input type="radio" name={`q${i}`} value={j} required /> {o}</label>)}
              </fieldset>
            ))}
          </section>
        ) : null}
        <section className="card card-pad" aria-labelledby="confirm-h">
          <h2 id="confirm-h" className="label mb-8">{questions.length ? '3' : '2'} · Confirm</h2>
          <dl className="dl mb-16">
            <div><dt>Signed in as</dt><dd>{me.user.name}</dd></div>
            <div><dt>Account</dt><dd>{me.user.email}</dd></div>
          </dl>
          <p className="small muted mb-8">You are signed in with your Microsoft 365 account (single sign-on). That sign-in identifies you on this record; you don’t sign again here. This is a training record, not an electronic signature.</p>
          <label className="check statement" style={{ alignItems: 'flex-start', padding: '14px 16px' }}>
            <input type="checkbox" name="confirm" required style={{ marginTop: 3 }} /> <span style={{ fontWeight: 600 }}>{statement}</span>
          </label>
          <p className="small muted mt-16">The app records the date and time when you confirm; nobody can type or change them. Once confirmed, the record is locked and can’t be edited or deleted by anyone. A Quality Manager can only add a correction, as a new record.</p>
          <button className="btn btn-primary mt-8" type="submit">Confirm read and understood</button>
        </section>
      </form>
    </>
  );
}
