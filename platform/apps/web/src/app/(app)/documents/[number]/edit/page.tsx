import { load } from '@/lib/page';
import type { DocumentDetail } from '@/lib/types';
import { Notice } from '@/components/ui';
import { saveDraft } from '../../actions';

export const metadata = { title: 'Edit draft' };

export default async function EditDraftPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const d = await load<DocumentDetail>(`/documents/${encodeURIComponent(number)}`);
  const text = d.current.content.map((b) => (b.t === 'h' ? `## ${b.x}` : b.x)).join('\n\n');
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/documents">Documents</a><span>/</span><a href={`/documents/${d.number}`}>{d.number}</a><span>/</span><span>Edit</span></nav>
      <h1 className="mb-16">Edit {d.number} v{d.current.version}</h1>
      <Notice ok={sp.ok} err={sp.err} />
      {!d.can.edit ? <div className="callout warn">This version is {d.current.state}, so it can’t be edited. Start a new version to change it.</div> : (
        <form action={saveDraft.bind(null, d.number)} className="card card-pad">
          <div className="field mb-16"><label htmlFor="dc">Content</label>
            <textarea className="textarea" id="dc" name="content" defaultValue={text} style={{ minHeight: 360, fontFamily: 'var(--font-mono)', fontSize: 13 }} />
            <div className="help">Start a line with “## ” for a heading. Leave a blank line between paragraphs.</div></div>
          <div className="field"><label htmlFor="cs">Change summary (required)</label>
            <textarea className="textarea" id="cs" name="summary" required defaultValue={d.current.summary} placeholder="What changed and why, in plain words" /></div>
          <div className="btn-row mt-16"><button className="btn btn-primary" type="submit">Save draft</button><a className="btn" href={`/documents/${d.number}`}>Cancel</a></div>
        </form>)}
    </>
  );
}
