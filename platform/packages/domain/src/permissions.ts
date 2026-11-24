// Roles and permissions. Mirrors the prototype (veqms/js/store.js). The API checks every permission;
// the web app uses the same map only to hide buttons.

export const ROLES = ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'System Administrator',
  qm: 'Quality Manager',
  author: 'Document Owner / Author',
  reviewer: 'Reviewer',
  approver: 'Approver',
  process: 'Process Owner',
  employee: 'Employee / Trainee',
  auditor: 'Auditor (read-only)',
};

const ALL_WRITERS: readonly Role[] = ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee'];

export const PERMISSIONS = {
  'write': ALL_WRITERS,
  'doc.create': ['author', 'qm'],
  'doc.approve': ['approver', 'qm'],
  'cr.create': ['process', 'qm', 'author'],
  'qe.create': ['process', 'qm', 'reviewer', 'author'],
  'capa.manage': ['process', 'qm'],
  'obs.raise': ALL_WRITERS,
  'training.manage': ['qm'],
  'training.org': ['qm', 'auditor', 'process', 'admin'],
  'approvals.view': ['qm', 'auditor', 'process', 'admin', 'approver', 'author', 'reviewer'],
  'reviews.org': ['qm', 'auditor', 'process', 'admin'],
  'analytics': ['qm', 'process', 'auditor', 'approver', 'admin'],
  'admin.users': ['admin'],
  'admin.settings': ['admin', 'qm'],
  'admin.audit': ['admin', 'qm', 'auditor'],
  'admin.integrations': ['admin'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(roles: readonly Role[], perm: Permission): boolean {
  const allowed: readonly Role[] = PERMISSIONS[perm];
  return roles.some((r) => allowed.includes(r));
}

export const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const rank = (c: Classification): number => CLASSIFICATIONS.indexOf(c);

/** A user sees a record when their clearance covers its class, or when they are involved in it. */
export function canSee(clearance: Classification, recordClass: Classification, involved: boolean): boolean {
  return rank(clearance) >= rank(recordClass) || involved;
}

/** Restricted downloads need Restricted clearance, even for people involved in the record. */
export function canDownload(clearance: Classification, recordClass: Classification, classAllowsDownload: boolean): boolean {
  if (recordClass === 'Restricted') return clearance === 'Restricted';
  return rank(clearance) >= rank(recordClass) && classAllowsDownload;
}

export interface SodSettings { adminCannotApprove: boolean; authorCannotApprove: boolean }

/** Segregation of duties for in-app signatures. Returns the refusal reason, or null when the user may sign. */
export function sodBlock(
  signer: { id: string; roles: readonly Role[] },
  record: { kind: 'doc' | 'cr' | 'other'; authorId?: string; ownerId?: string },
  settings: SodSettings,
): string | null {
  if (!can(signer.roles, 'write')) return 'Your role is read-only.';
  if (settings.adminCannotApprove && signer.roles.includes('admin') && !signer.roles.includes('approver') && !signer.roles.includes('qm')) {
    return 'System Administrators cannot approve quality records (segregation of duties).';
  }
  if (record.kind === 'doc' && settings.authorCannotApprove && record.authorId === signer.id) {
    return 'You authored this version, so you cannot approve it. An admin override is needed, and it is logged.';
  }
  if (record.kind === 'cr' && record.ownerId === signer.id) return 'You own this change request, so you cannot approve its plan.';
  return null;
}
