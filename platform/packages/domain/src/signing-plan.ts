// Who signs a DocuSign envelope, in what order, and what is wrong with the plan.
// One envelope per version holds every signer: author (1), reviewers in parallel (2), then QA approvers in order.
import type { Role } from './permissions.ts';

export interface PlanUser { id: string; name: string; active: boolean; roles: readonly Role[] }
export interface PlannedSigner { userId: string; role: string; meaning: 'Authored' | 'Reviewed' | 'Approved'; order: number }
export interface SigningPlan { signers: PlannedSigner[]; problems: string[] }

function approverProblems(approvers: readonly PlanUser[]): string[] {
  const out: string[] = [];
  if (approvers.length === 0) out.push('Choose a QA approver.');
  for (const u of approvers) {
    if (!u.active) out.push(`${u.name} is not an active user.`);
    else if (!u.roles.includes('approver') && !u.roles.includes('qm')) out.push(`${u.name} doesn’t hold the Approver or Quality Manager role.`);
  }
  return out;
}

export function documentPlan(author: PlanUser, reviewers: readonly PlanUser[], approvers: readonly PlanUser[]): SigningPlan {
  const signers: PlannedSigner[] = [{ userId: author.id, role: 'Author', meaning: 'Authored', order: 1 }];
  for (const r of reviewers) signers.push({ userId: r.id, role: 'Reviewer', meaning: 'Reviewed', order: 2 });
  const base = reviewers.length ? 3 : 2;
  approvers.forEach((a, i) => signers.push({
    userId: a.id, role: approvers.length > 1 ? `QA approver ${i + 1}` : 'QA approver', meaning: 'Approved', order: base + i,
  }));
  const problems = approverProblems(approvers);
  for (const a of approvers) {
    if (a.id === author.id) problems.push(`${a.name} authored this version, so they can’t approve it (segregation of duties). Choose another QA approver.`);
    if (reviewers.some((r) => r.id === a.id)) problems.push(`${a.name} is a reviewer, so they can’t also be the QA approver.`);
  }
  for (const p of [author, ...reviewers]) if (!p.active) problems.push(`${p.name} is no longer active.`);
  return { signers, problems };
}

/** CAPA and deviation closures: the owner, then one QA approver who is not the owner. */
export function closurePlan(owner: PlanUser, approvers: readonly PlanUser[], closureRecorded: boolean, kind: 'capa' | 'deviation'): SigningPlan {
  const signers: PlannedSigner[] = [{ userId: owner.id, role: kind === 'capa' ? 'CAPA owner' : 'Deviation owner', meaning: 'Authored', order: 1 }];
  approvers.forEach((a, i) => signers.push({ userId: a.id, role: 'QA approver', meaning: 'Approved', order: 2 + i }));
  const problems = approverProblems(approvers);
  for (const a of approvers) if (a.id === owner.id) problems.push(`${a.name} owns this record, so they can’t also approve its closure.`);
  if (!closureRecorded) problems.push(kind === 'capa' ? 'Record the effectiveness result first.' : 'Write the closure justification first.');
  if (!owner.active) problems.push(`${owner.name} is no longer active.`);
  return { signers, problems };
}
