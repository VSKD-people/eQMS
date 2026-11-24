// Role-based permissions. The API checks these on every request; the web app uses them only to hide buttons.
import type { Role } from './types.ts';

export const PERMISSIONS = {
  'write': ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee'],
  'doc.create': ['author', 'qm'],
  'doc.approve': ['approver', 'qm'],
  'esign.send': ['author', 'qm', 'process'],
  'training.manage': ['qm'],
  'training.org': ['qm', 'auditor', 'process', 'admin'],
  'approvals.view': ['qm', 'auditor', 'process', 'admin', 'approver', 'author', 'reviewer'],
  'admin.users': ['admin'],
  'admin.settings': ['admin', 'qm'],
  'audit.read': ['admin', 'qm', 'auditor']
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(roles: readonly Role[], perm: Permission): boolean {
  const allowed: readonly Role[] = PERMISSIONS[perm];
  return roles.some((r) => allowed.includes(r));
}

export function isReadOnly(roles: readonly Role[]): boolean {
  return !can(roles, 'write');
}

// Segregation of duties: an admin-only account can never approve quality records.
export function canBeApprover(roles: readonly Role[]): boolean {
  return roles.includes('qm') || roles.includes('approver');
}
