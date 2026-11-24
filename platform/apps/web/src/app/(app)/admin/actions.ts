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

// ---------- Users and roles (System Administrator) ----------
const USERS = '/admin?tab=users';
const ROLES = ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee', 'auditor'];
const reasonOf = (fd: FormData) => str(fd, 'reason');

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
