'use server';
import { redirect } from 'next/navigation';
import { str } from '@/lib/api';
import { mutate, withMsg } from '@/lib/actions';

const BACK = '/admin?tab=settings';

function int(v: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

export async function saveSettings(fd: FormData) {
  const docusignAllowance = int(str(fd, 'docusignAllowance'), 0, 100000);
  const allowanceYearStartMonth = int(str(fd, 'allowanceYearStartMonth'), 1, 12);
  const allowanceWarnAt = int(str(fd, 'allowanceWarnAt'), 0, 100000);
  const overdueRepeatDays = int(str(fd, 'overdueRepeatDays'), 1, 90);
  const reminderDays = str(fd, 'reminderDays').split(',').map((s) => s.trim()).filter(Boolean).map((s) => int(s, 0, 365));
  const ackStatement = str(fd, 'ackStatement');
  if (docusignAllowance === null || allowanceYearStartMonth === null || allowanceWarnAt === null || overdueRepeatDays === null || reminderDays.some((d) => d === null)) {
    redirect(withMsg(BACK, 'err', 'Check the numbers: whole numbers only, and reminder days as a comma-separated list such as 7, 3, 1.'));
  }
  if (!ackStatement.includes('{number}') || !ackStatement.includes('{version}')) {
    redirect(withMsg(BACK, 'err', 'The statement must include {number} and {version}.'));
  }
  await mutate('/settings', {
    method: 'PUT',
    body: { docusignAllowance, allowanceYearStartMonth, allowanceWarnAt, ackStatement, reminderDays: reminderDays as number[], overdueRepeatDays }
  }, BACK, 'Settings saved. The change is logged with the old and new values.');
}
