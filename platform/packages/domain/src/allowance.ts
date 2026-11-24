// DocuSign send allowance, counted per allowance year. Matches allowance_year() in packages/db (UTC).

/** First calendar year of the allowance year containing `at`. startMonth is 1 to 12. */
export function allowanceYear(at: Date, startMonth: number): number {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError('startMonth must be 1 to 12');
  const m = at.getUTCMonth() + 1;
  return m >= startMonth ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
}

/** Start (inclusive) and end (exclusive) of the allowance year containing `at`, in UTC. */
export function allowanceRange(at: Date, startMonth: number): { start: Date; end: Date } {
  const y = allowanceYear(at, startMonth);
  return { start: new Date(Date.UTC(y, startMonth - 1, 1)), end: new Date(Date.UTC(y + 1, startMonth - 1, 1)) };
}

export function remaining(allowance: number, used: number): number {
  return Math.max(0, allowance - used);
}
