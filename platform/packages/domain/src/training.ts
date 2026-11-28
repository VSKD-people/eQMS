// Route 2: read-and-understood training records (not Part 11 signatures).
// Records are attributable (SSO user), tied to one version, dated by the system and locked once completed.
import type { Audience, Role, TrainingRecordLike, TrainingStatus, UserRef } from './types.ts';

export const DEFAULT_ACK_STATEMENT = 'I confirm I have read and understood {doc}, version {version}';

export function ackStatement(template: string, documentNumber: string, version: string): string {
  return template.replaceAll('{doc}', documentNumber).replaceAll('{version}', version);
}

export function hasAudience(a: Audience | null | undefined): boolean {
  return !!a && (a.groups.length > 0 || a.roles.length > 0 || a.users.length > 0);
}

export function inAudience(a: Audience | null | undefined, u: UserRef): boolean {
  if (!a || u.status !== 'active') return false;
  return a.groups.some((g) => u.groups.includes(g)) || a.roles.some((r: Role) => u.roles.includes(r)) || a.users.includes(u.id);
}

export interface StatusContext {
  now: Date;
  effectiveVersion: string | null; // null when the document has no effective version (e.g. obsolete)
  // Earlier versions whose training still counts: the versions since the last one that needed retraining (an approver
  // can decide a change needs no retraining). Absent or empty: only the effective version counts.
  equivalentVersions?: readonly string[];
  correctedIds: ReadonlySet<string>; // ids of records that a later record corrects
}

export function trainingStatus(r: TrainingRecordLike, ctx: StatusContext): TrainingStatus {
  if (r.correctionOf && r.noRetrain) return 'Correction';
  if (ctx.correctedIds.has(r.id)) return 'Corrected';
  if (!ctx.effectiveVersion) return 'Obsolete';
  if (ctx.effectiveVersion !== r.version && !(ctx.equivalentVersions ?? []).includes(r.version)) return 'Superseded';
  if (r.closedAt) return 'Withdrawn';
  if (r.completedAt) return 'Complete';
  if (r.dueAt && new Date(r.dueAt).getTime() < ctx.now.getTime()) return 'Overdue';
  return 'Assigned';
}

export function isOpen(status: TrainingStatus): boolean {
  return status === 'Assigned' || status === 'Overdue';
}

// One cell of the training matrix (person by document).
export type MatrixStatus = 'Complete' | 'Assigned' | 'Overdue' | 'Superseded' | 'Not allocated' | 'Not required';
export interface MatrixCell { status: MatrixStatus; versionTrained: string | null; currentVersion: string; recordId: string | null }

export function matrixCell(
  user: UserRef, audience: Audience | null, currentVersion: string,
  records: (TrainingRecordLike & { status: TrainingStatus; assignedAt: string })[],
  equivalentVersions: readonly string[] = []
): MatrixCell | null {
  const counts = (v: string) => v === currentVersion || equivalentVersions.includes(v);
  const mine = records.filter((r) => r.userId === user.id && !r.noRetrain && !r.closedAt).sort((a, b) => (a.assignedAt < b.assignedAt ? 1 : -1));
  const cur = mine.find((r) => counts(r.version) && r.status !== 'Corrected');
  if (cur) {
    const status: MatrixStatus = cur.status === 'Complete' ? 'Complete' : cur.status === 'Overdue' ? 'Overdue' : 'Assigned';
    return { status, versionTrained: cur.completedAt ? cur.version : null, currentVersion, recordId: cur.id };
  }
  const older = mine.filter((r) => r.completedAt && !counts(r.version)).sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))[0];
  if (inAudience(audience, user)) return { status: older ? 'Superseded' : 'Not allocated', versionTrained: older?.version ?? null, currentVersion, recordId: older?.id ?? null };
  if (older) return { status: 'Not required', versionTrained: older.version, currentVersion, recordId: older.id };
  return null;
}

export function dueDate(from: Date, days: number): Date {
  return new Date(from.getTime() + Math.max(1, Math.round(days)) * 86_400_000);
}
