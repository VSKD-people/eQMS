'use server';
import { redirect } from 'next/navigation';
import { list, str } from '@/lib/api';
import { mutate, withMsg } from '@/lib/actions';

const BACK = '/admin?tab=settings';

function int(v: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

export async function saveSettings(fd: FormData) {
  const signingAllowance = int(str(fd, 'signingAllowance'), 0, 100000);
  const allowanceYearStartMonth = int(str(fd, 'allowanceYearStartMonth'), 1, 12);
  const allowanceWarnAt = int(str(fd, 'allowanceWarnAt'), 0, 100000);
  const overdueRepeatDays = int(str(fd, 'overdueRepeatDays'), 1, 90);
  const reminderDays = str(fd, 'reminderDays').split(',').map((s) => s.trim()).filter(Boolean).map((s) => int(s, 0, 365));
  const ackStatement = str(fd, 'ackStatement');
  if (signingAllowance === null || allowanceYearStartMonth === null || allowanceWarnAt === null || overdueRepeatDays === null || reminderDays.some((d) => d === null)) {
    redirect(withMsg(BACK, 'err', 'Check the numbers: whole numbers only, and reminder days as a comma-separated list such as 7, 3, 1.'));
  }
  if (!ackStatement.includes('{doc}') || !ackStatement.includes('{version}')) {
    redirect(withMsg(BACK, 'err', 'The statement must include {doc} and {version}.'));
  }
  await mutate('/settings', {
    method: 'PUT',
    body: { signingAllowance, allowanceYearStartMonth, allowanceWarnAt, ackStatement, reminderDays: reminderDays as number[], overdueRepeatDays }
  }, BACK, 'Settings saved. The change is logged with the old and new values.');
}

// ---------- SharePoint ----------
const SP_TAB = '/admin?tab=sharepoint';
export async function syncNow() {
  await mutate('/sharepoint/sync', { method: 'POST' }, SP_TAB, 'Synced: waiting versions published, and both libraries checked for changes.');
}
export async function resolveAlert(id: string, fd: FormData) {
  const note = str(fd, 'note');
  if (note.length < 10) redirect(withMsg(SP_TAB, 'err', 'Say what was found and what was done (at least a short sentence).'));
  await mutate(`/sharepoint/alerts/${id}/resolve`, { method: 'POST', body: { note } }, SP_TAB, 'Alert resolved. Your note is in the audit trail.');
}
export async function republish(versionId: string) {
  await mutate(`/sharepoint/versions/${versionId}/republish`, { method: 'POST' }, SP_TAB, 'Queued to publish again. Sync now to try at once.');
}
export async function simulateOutsideEdit(fd: FormData) {
  await mutate('/sharepoint/mock/outside-edit', { method: 'POST', body: { number: str(fd, 'number').toUpperCase() } }, SP_TAB, 'Simulated an outside edit. Sync now to see the alert.');
}

// ---------- Users and roles (System Administrator) ----------
const USERS = '/admin?tab=users';
const ROLES = ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee', 'auditor'];
const reasonOf = (fd: FormData) => str(fd, 'reason');

// Add a person. With email and password sign-in the administrator sets a temporary password (told to the person
// directly, never by email), which they must change at their first sign-in. With Microsoft sign-in, SCIM adds people.
export async function addUser(fd: FormData) {
  const roles = list(fd, 'roles').filter((r) => ROLES.includes(r));
  if (!roles.length) redirect(withMsg(USERS, 'err', 'Choose at least one role.'));
  const body = { email: str(fd, 'email'), name: str(fd, 'name'), jobTitle: str(fd, 'jobTitle') || undefined, roles, groups: list(fd, 'groups'),
    clearance: str(fd, 'clearance') || 'Internal', temporaryPassword: str(fd, 'temporaryPassword') || undefined };
  await mutate('/users', { method: 'POST', body }, USERS, `${body.name} added. Give them their temporary password directly; they must change it when they first sign in.`);
}

export async function resetPassword(userId: string, fd: FormData) {
  const reason = reasonOf(fd);
  if (reason.length < 5) redirect(withMsg(USERS, 'err', 'Give a reason for the reset (at least 5 characters).'));
  await mutate(`/users/${encodeURIComponent(userId)}/password`, { method: 'POST', body: { temporaryPassword: str(fd, 'temporaryPassword'), reason } }, USERS,
    'Password reset and any lock cleared. Their open sessions have ended; they must change the temporary password when they sign in.');
}

export async function saveRoles(userId: string, fd: FormData) {
  const roles = list(fd, 'roles').filter((r) => ROLES.includes(r));
  const reason = reasonOf(fd);
  if (!roles.length) redirect(withMsg(USERS, 'err', 'Choose at least one role.'));
  if (reason.length < 5) redirect(withMsg(USERS, 'err', 'Give a reason for the change (at least 5 characters).'));
  await mutate(`/users/${encodeURIComponent(userId)}/roles`, { method: 'PUT', body: { roles, reason } }, USERS, 'Roles changed. The change is logged and the person has been told.');
}

export async function saveStatus(userId: string, fd: FormData) {
  const status = str(fd, 'status');
  const reason = reasonOf(fd);
  if (!['active', 'revoked', 'left'].includes(status)) redirect(withMsg(USERS, 'err', 'Choose a status.'));
  if (reason.length < 5) redirect(withMsg(USERS, 'err', 'Give a reason for the change (at least 5 characters).'));
  await mutate(`/users/${encodeURIComponent(userId)}/status`, { method: 'PUT', body: { status, reason } }, USERS,
    status === 'active' ? 'Access restored. Training has been allocated again.' : 'Access removed and sessions ended. Open training is closed; completed records are kept.');
}

export async function endSessions(userId: string) {
  await mutate(`/users/${encodeURIComponent(userId)}/revoke-sessions`, { method: 'POST' }, USERS, 'All sessions ended. They must sign in again.');
}
