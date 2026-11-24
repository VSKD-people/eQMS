import type { Audience, Group, UserRow } from '@/lib/types';
import { ROLE_LABEL, type Role } from '@veqms/domain';

// Who must train on a document: groups (including All staff), roles and named people.
export function AudienceFields({ groups, users, value }: { groups: Group[]; users: UserRow[] | null; value?: Audience }) {
  const v = value ?? { groups: [], roles: [], users: [], daysToComplete: 14, quiz: false };
  return (
    <>
      <fieldset className="full mb-16"><legend>Groups</legend>
        <div className="grid-2" style={{ gap: '0 16px' }}>{groups.map((g) => (
          <label className="check" key={g.id}><input type="checkbox" name="groups" value={g.name} defaultChecked={v.groups.includes(g.name)} /> {g.name}</label>
        ))}</div>
      </fieldset>
      <fieldset className="full mb-16"><legend>Roles</legend>
        <div className="grid-2" style={{ gap: '0 16px' }}>{(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== 'auditor').map((r) => (
          <label className="check" key={r}><input type="checkbox" name="roles" value={r} defaultChecked={v.roles.includes(r)} /> {ROLE_LABEL[r]}</label>
        ))}</div>
      </fieldset>
      {users ? (
        <details className="full mb-16"><summary className="btn-link" style={{ padding: 0 }}>Named people ({v.users.length})</summary>
          <div className="grid-2 mt-8" style={{ gap: '0 16px' }}>{users.filter((u) => u.status === 'active' && !u.roles.includes('auditor')).map((u) => (
            <label className="check" key={u.id}><input type="checkbox" name="users" value={u.id} defaultChecked={v.users.some((x) => x.id === u.id)} /> {u.name}</label>
          ))}</div>
        </details>
      ) : null}
      <div className="form-grid">
        <div className="field"><label htmlFor="aud-days">Days to complete</label><input className="input" type="number" min={1} id="aud-days" name="days" defaultValue={v.daysToComplete} /></div>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="quiz" defaultChecked={v.quiz} /> Include a knowledge check</label>
      </div>
    </>
  );
}
