import 'server-only';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, errorMessage, NotSignedIn, type CallOptions } from './api';

// Run an API mutation from a Server Action, then go back to `to` with a message in the query string.
// redirect() must stay outside try/catch because it works by throwing.
export async function mutate(path: string, o: CallOptions, to: string, okMessage: string, errorTo?: string): Promise<never> {
  let err: string | null = null;
  let signedOut = false;
  try {
    await api(path, { ...o, canWrite: true });
  } catch (e) {
    if (e instanceof NotSignedIn) signedOut = true;
    err = errorMessage(e);
  }
  if (signedOut) redirect(`/login?next=${encodeURIComponent(to)}`);
  if (err) redirect(withMsg(errorTo ?? to, 'err', err));
  revalidatePath(to.split('?')[0] ?? '/');
  redirect(withMsg(to, 'ok', okMessage));
}

export function withMsg(url: string, key: 'ok' | 'err', msg: string): string {
  const [path, query] = url.split('?');
  const q = new URLSearchParams(query ?? '');
  q.delete('ok'); q.delete('err');
  q.set(key, msg);
  return `${path}?${q.toString()}`;
}
