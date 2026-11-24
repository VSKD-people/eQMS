// The yearly allowance of Adobe Sign transactions (500 a year by default, to be confirmed against the contract).
// Adobe counts one transaction per agreement sent, whatever the number of signers; a correction after sending
// (cancel, then send again) is a second transaction.

export interface AllowanceYear { year: number; start: Date; end: Date }

// The allowance year that contains `at`. startMonth is 1-12 (1 = January). Dates are UTC.
export function allowanceYear(at: Date, startMonth = 1): AllowanceYear {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) throw new RangeError('startMonth must be 1-12');
  const m = startMonth - 1;
  const y = at.getUTCMonth() >= m ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  return { year: y, start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y + 1, m, 1)) };
}

export interface AllowanceState { allowance: number; used: number; remaining: number; low: boolean; exhausted: boolean }

export function allowanceState(allowance: number, used: number, warnAt: number): AllowanceState {
  const remaining = Math.max(0, allowance - used);
  return { allowance, used, remaining, low: remaining <= warnAt, exhausted: remaining <= 0 };
}
