// Adobe Sign webhooks and status mapping.
//
// Adobe Sign does not sign webhook notifications (no HMAC). It checks the endpoint instead: every request, including
// the first "verification of intent" GET, carries an X-AdobeSign-ClientId header, and the endpoint must answer 2xx and
// echo the same value back (header or JSON body), or Adobe counts the delivery as failed. So VeQMS accepts a
// notification only when the URL carries its secret token and the client ID is the one configured, and even then it
// never acts on the body: it reads the agreement from Adobe Sign itself ("the webhook notifies, the API confirms").
// Verify against Adobe's current webhook guide before go-live: the header name, the echo format, and the event names.
import { timingSafeEqual } from 'node:crypto';

// Constant-time comparison of a presented secret with the configured one. An empty configured value never matches.
export function secretMatches(expected: string, given: string | undefined): boolean {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// The client ID header Adobe Sign sends, and the JSON body that echoes it back.
export const ADOBE_CLIENT_ID_HEADER = 'x-adobesign-clientid';
export function webhookEcho(clientId: string): { xAdobeSignClientId: string } {
  return { xAdobeSignClientId: clientId };
}

// Agreement status values from Adobe Sign (REST API v6) mapped to VeQMS's four states. Adobe reports both a sender's
// cancellation and a signer's rejection as CANCELLED (newer accounts: ABORTED), so the caller tells them apart using
// the agreement's events (see participantEvent). EXPIRED is terminal too, and handled like a cancellation.
export function mapAgreementStatus(s: string): 'sent' | 'completed' | 'cancelled' | null {
  switch ((s || '').toUpperCase()) {
    case 'OUT_FOR_SIGNATURE': case 'OUT_FOR_APPROVAL': case 'OUT_FOR_ACCEPTANCE': case 'OUT_FOR_DELIVERY': case 'OUT_FOR_FORM_FILLING':
    case 'WAITING_FOR_VERIFICATION': case 'WAITING_FOR_FAXIN': case 'WAITING_FOR_NOTARIZATION':
      return 'sent';
    case 'SIGNED': case 'APPROVED': case 'ACCEPTED': case 'DELIVERED': case 'FORM_FILLED':
      return 'completed';
    case 'CANCELLED': case 'ABORTED': case 'EXPIRED': case 'ABANDONED':
      return 'cancelled';
    default:
      return null;
  }
}

// What an event in the agreement's history means for one participant: they signed, or they declined (rejected).
export function participantEvent(type: string): 'signed' | 'declined' | null {
  switch ((type || '').toUpperCase()) {
    case 'ESIGNED': case 'DIGSIGNED': case 'SIGNED': case 'APPROVED': case 'ACTION_COMPLETED':
      return 'signed';
    case 'REJECTED': case 'DECLINED':
      return 'declined';
    default:
      return null;
  }
}
