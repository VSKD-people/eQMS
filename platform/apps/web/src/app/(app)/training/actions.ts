'use server';
import { redirect } from 'next/navigation';
import { bool, str } from '@/lib/api';
import { mutate, withMsg } from '@/lib/actions';

export async function confirmTraining(id: string, questions: number, fd: FormData) {
  if (!bool(fd, 'confirm')) redirect(withMsg(`/training/${id}`, 'err', 'Tick the statement to confirm.'));
  const quizAnswers: number[] = [];
  for (let i = 0; i < questions; i++) {
    const v = fd.get(`q${i}`);
    if (typeof v !== 'string') redirect(withMsg(`/training/${id}`, 'err', 'Answer every question in the knowledge check.'));
    quizAnswers.push(Number(v));
  }
  await mutate(`/training/records/${id}/complete`, { method: 'POST', body: { confirm: true, quizAnswers: questions ? quizAnswers : undefined } },
    '/training', 'Recorded. Your record is dated by the system and locked.', `/training/${id}`);
}

export async function recordCorrection(id: string, fd: FormData) {
  const reason = str(fd, 'reason');
  if (reason.length < 10) redirect(withMsg(`/training/records/${id}`, 'err', 'Give a reason of at least a few words.'));
  await mutate(`/training/records/${id}/corrections`, { method: 'POST', body: { reason, retrain: str(fd, 'mode') !== 'void' } },
    `/training/records/${id}`, 'Correction recorded as a new record. The original is unchanged.');
}

export async function sendReminders() {
  await mutate('/training/reminders', { method: 'POST' }, '/training/records', 'Reminders sent and logged.');
}
