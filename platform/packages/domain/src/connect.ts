// DocuSign Connect webhook verification. DocuSign signs each message with HMAC-SHA256 over the raw body and sends
// the base64 result in X-DocuSign-Signature-1 (and -2 … when several keys are active). Verify the header names and
// behaviour against the current DocuSign Connect documentation before go-live.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function connectSignature(secret: string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function verifyConnectHmac(secrets: string[], rawBody: Buffer | string, headerValues: (string | undefined)[]): boolean {
  const given = headerValues.filter((v): v is string => !!v).map((v) => Buffer.from(v, 'utf8'));
  if (!given.length || !secrets.length) return false;
  for (const secret of secrets) {
    const expected = Buffer.from(connectSignature(secret, rawBody), 'utf8');
    for (const g of given) if (g.length === expected.length && timingSafeEqual(g, expected)) return true;
  }
  return false;
}

// Map a DocuSign envelope or recipient status to ours.
export function mapEnvelopeStatus(s: string): 'sent' | 'completed' | 'declined' | 'voided' | null {
  switch ((s || '').toLowerCase()) {
    case 'sent': case 'delivered': return 'sent';
    case 'completed': return 'completed';
    case 'declined': return 'declined';
    case 'voided': return 'voided';
    default: return null;
  }
}
export function mapRecipientStatus(s: string): 'sent' | 'delivered' | 'signed' | 'declined' | null {
  switch ((s || '').toLowerCase()) {
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'completed': case 'signed': return 'signed';
    case 'declined': return 'declined';
    default: return null;
  }
}
