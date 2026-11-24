// DocuSign Connect HMAC check. Step 1 records as verified: Connect signs with HMAC-SHA256 and sends it in
// X-DocuSign-Signature-1 once HMAC is enabled. VERIFY before go-live: that the value is base64 of the raw
// body's HMAC, and how many signature headers (one per active key) can arrive.
// Connect notifies, the API confirms: a valid HMAC only lets the API re-fetch the envelope status.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function connectSignature(rawBody: Buffer, key: string): string {
  return createHmac('sha256', key).update(rawBody).digest('base64');
}

/** True when any signature header matches any configured key. Compares in constant time. */
export function verifyConnectHmac(rawBody: Buffer, headerValues: readonly string[], keys: readonly string[]): boolean {
  if (headerValues.length === 0 || keys.length === 0) return false;
  let ok = false;
  for (const key of keys) {
    const expected = Buffer.from(connectSignature(rawBody, key));
    for (const v of headerValues) {
      const got = Buffer.from(v.trim());
      if (got.length === expected.length && timingSafeEqual(got, expected)) ok = true;
    }
  }
  return ok;
}
