// Date and status formatting, British English. Display dates in UK time; record timestamps in UTC.
const TZ = 'Europe/London';

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(new Date(iso));
}
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(iso));
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
}
export function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function daysFromNow(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const startOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOf(new Date(iso)) - startOf(new Date())) / 86_400_000);
}

export function relDue(iso: string | null | undefined): { text: string; cls: string } {
  const n = daysFromNow(iso);
  if (n === null) return { text: 'No due date', cls: 'chip-outline' };
  if (n < 0) return { text: `Overdue ${-n} day${n === -1 ? '' : 's'}`, cls: 'chip-overdue' };
  if (n === 0) return { text: 'Due today', cls: 'chip-due' };
  if (n === 1) return { text: 'Due tomorrow', cls: 'chip-due' };
  if (n <= 7) return { text: `Due ${fmtShort(iso)}`, cls: 'chip-due' };
  return { text: `Due ${fmtShort(iso)}`, cls: 'chip-outline' };
}

const STATE_CLS: Record<string, string> = {
  Effective: 'chip-done', Closed: 'chip-done', Complete: 'chip-done', Completed: 'chip-done', completed: 'chip-done', Signed: 'chip-done', signed: 'chip-done', Reviewed: 'chip-done',
  'In review': 'chip-turn', 'In approval': 'chip-turn', Signing: 'chip-turn', Assigned: 'chip-turn', sent: 'chip-turn', delivered: 'chip-turn', 'Your turn': 'chip-turn',
  'Effectiveness check': 'chip-due', Assessment: 'chip-due', Superseded: 'chip-due', 'Not allocated': 'chip-overdue',
  Overdue: 'chip-overdue', declined: 'chip-overdue', Declined: 'chip-overdue',
  Draft: 'chip-outline', Obsolete: 'chip-outline', Withdrawn: 'chip-outline', Corrected: 'chip-outline', Correction: 'chip-outline',
  cancelled: 'chip-outline', waiting: 'chip-outline', Waiting: 'chip-outline', 'Not required': 'chip-outline',
  OK: 'chip-done', Published: 'chip-done', 'Marked superseded': 'chip-outline', Failed: 'chip-overdue', Running: 'chip-turn'
};
export function chipClass(state: string): string { return STATE_CLS[state] ?? 'chip-outline'; }

export const AGREEMENT_STATUS: Record<string, string> = { sent: 'Out for signature', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled' };
export const SIGNER_STATUS: Record<string, string> = { waiting: 'Waiting', sent: 'With signer', signed: 'Signed', declined: 'Declined', cancelled: 'Cancelled' };

export function plural(n: number, one: string, many = one + 's'): string { return `${n} ${n === 1 ? one : many}`; }

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Query-string helper for links that keep the current filters.
export function qs(params: Record<string, string | number | undefined | null | false>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== false && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Link to the record an agreement or task belongs to.
export function recordHref(recordType: string, number: string): string {
  const n = encodeURIComponent(number);
  if (recordType === 'capa') return `/quality/capas/${n}`;
  if (recordType === 'quality_event') return `/quality/events/${n}`;
  return `/documents/${n}`;
}
