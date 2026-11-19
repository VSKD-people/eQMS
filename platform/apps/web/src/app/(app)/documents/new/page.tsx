import { DOC_TYPES } from '@veqms/domain';
import { load, loadOrNull, getMe } from '@/lib/page';
import type { Group, UserRow } from '@/lib/types';
import { Notice } from '@/components/ui';
import { AudienceFields } from '../AudienceFields';
import { createDocument } from '../actions';

export const metadata = { title: 'New document' };
const PROCESSES = ['ISMS · Governance', 'ISMS · Access control', 'ISMS · Continuity', 'ISMS · Risk', 'ISMS · People', 'ISMS · Supplier management', 'ISMS · Vulnerability mgmt', 'ISMS · Incident management', 'ISMS · Information handling', 'ISMS · Awareness'];

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  const [groups, users] = await Promise.all([load<Group[]>('/groups'), loadOrNull<UserRow[]>('/users')]);
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/documents">Documents</a><span>/</span><span>New</span></nav>
      <h1 className="mb-16">New document</h1>
      <Notice err={sp.err} />
      <form action={createDocument} className="card card-pad">
        <div className="form-grid">
          <div className="field"><label htmlFor="nt">Document type</label><select className="select" id="nt" name="docType">{DOC_TYPES.map((t) => <option key={t.type}>{t.type}</option>)}</select><div className="help">Numbered automatically, e.g. SOP-022.</div></div>
          <div className="field"><label htmlFor="ncl">Classification</label><select className="select" id="ncl" name="classification" defaultValue="Internal">{['Public', 'Internal', 'Confidential', 'Restricted'].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field full"><label htmlFor="ntt">Title</label><input className="input" id="ntt" name="title" required /></div>
          <div className="field"><label htmlFor="no">Owner</label>
            <select className="select" id="no" name="ownerId" defaultValue={me.user.id}>
              {(users ?? [{ id: me.user.id, name: me.user.name, status: 'active' }] as { id: string; name: string; status: string }[]).filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="np">Quality process</label><select className="select" id="np" name="process">{PROCESSES.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="field full"><label htmlFor="ntg">Tags</label><input className="input" id="ntg" name="tags" placeholder="e.g. A.7.7, Clause 7.5" /><div className="help">Separate with commas.</div></div>
        </div>
        <h2 className="label mt-24 mb-8">Who must train on it (read and understood)</h2>
        <AudienceFields groups={groups} users={users} />
        <div className="btn-row mt-24"><button className="btn btn-primary" type="submit">Create draft</button><a className="btn" href="/documents">Cancel</a></div>
      </form>
    </>
  );
}
