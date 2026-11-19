// DocuSign eSignature REST API v2.1 client (JWT grant), plus a mock for development and UAT.
// Verify against DocuSign's current documentation before go-live: endpoint paths, the JWT claims, the envelope
// JSON (recipients, tabs, note, customFields) and how the Part 11 module is enabled on the account.
import { SignJWT, importPKCS8 } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.ts';

export interface DsSigner { recipientId: string; name: string; email: string; routingOrder: number; meaning: string; anchor: string }
export interface DsCreate { subject: string; pdf: Uint8Array; fileName: string; signers: DsSigner[]; veqmsEnvelopeId: string }
export interface DsRecipientStatus { recipientId: string; status: string; signedAt: string | null; declinedReason: string | null }
export interface DsStatus { status: string; voidedReason: string | null; recipients: DsRecipientStatus[] }

export interface DocuSign {
  readonly mode: 'live' | 'mock';
  createEnvelope(e: DsCreate): Promise<string>;
  getStatus(envelopeId: string): Promise<DsStatus | null>; // null in mock mode: the database is the state
  voidEnvelope(envelopeId: string, reason: string): Promise<void>;
  downloadSigned(envelopeId: string): Promise<Uint8Array | null>;
  downloadCertificate(envelopeId: string): Promise<Uint8Array | null>;
}

export function createDocuSign(cfg: Config): DocuSign {
  return cfg.DOCUSIGN_MODE === 'live' ? new LiveDocuSign(cfg) : new MockDocuSign();
}

class LiveDocuSign implements DocuSign {
  readonly mode = 'live' as const;
  private token: { value: string; expires: number } | null = null;
  private readonly cfg: Config;
  constructor(cfg: Config) { this.cfg = cfg; }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const key = await importPKCS8(this.cfg.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
    const assertion = await new SignJWT({ scope: 'signature impersonation' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.cfg.DOCUSIGN_INTEGRATION_KEY)
      .setSubject(this.cfg.DOCUSIGN_USER_ID)
      .setAudience(this.cfg.DOCUSIGN_AUTH_SERVER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await fetch(`https://${this.cfg.DOCUSIGN_AUTH_SERVER}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
    });
    if (!res.ok) throw new Error(`DocuSign sign-in failed (${res.status}). Check the integration key, user consent and RSA key.`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private url(path: string): string { return `${this.cfg.DOCUSIGN_BASE_URI}/restapi/v2.1/accounts/${this.cfg.DOCUSIGN_ACCOUNT_ID}${path}`; }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetch(this.url(path), { method, headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`DocuSign ${method} ${path.split('?')[0]} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async createEnvelope(e: DsCreate): Promise<string> {
    const res = await this.call('POST', '/envelopes', {
      emailSubject: e.subject,
      status: 'sent',
      documents: [{ documentBase64: Buffer.from(e.pdf).toString('base64'), name: e.fileName, fileExtension: 'pdf', documentId: '1' }],
      recipients: {
        signers: e.signers.map((s) => ({
          recipientId: s.recipientId, routingOrder: String(s.routingOrder), name: s.name, email: s.email,
          note: `Signature meaning: ${s.meaning}`,
          tabs: { signHereTabs: [{ anchorString: s.anchor, anchorUnits: 'pixels', anchorXOffset: '0', anchorYOffset: '0' }] }
        }))
      },
      customFields: { textCustomFields: [{ name: 'veqmsEnvelopeId', value: e.veqmsEnvelopeId, show: 'false', required: 'false' }] }
    });
    const j = (await res.json()) as { envelopeId: string };
    return j.envelopeId;
  }

  async getStatus(envelopeId: string): Promise<DsStatus> {
    const env = (await (await this.call('GET', `/envelopes/${encodeURIComponent(envelopeId)}`)).json()) as { status: string; voidedReason?: string };
    const rec = (await (await this.call('GET', `/envelopes/${encodeURIComponent(envelopeId)}/recipients`)).json()) as { signers?: { recipientId: string; status: string; signedDateTime?: string; declinedReason?: string }[] };
    return {
      status: env.status, voidedReason: env.voidedReason ?? null,
      recipients: (rec.signers ?? []).map((s) => ({ recipientId: s.recipientId, status: s.status, signedAt: s.signedDateTime ?? null, declinedReason: s.declinedReason ?? null }))
    };
  }

  async voidEnvelope(envelopeId: string, reason: string): Promise<void> {
    await this.call('PUT', `/envelopes/${encodeURIComponent(envelopeId)}`, { status: 'voided', voidedReason: reason.slice(0, 200) });
  }

  private async bytes(path: string): Promise<Uint8Array> {
    const res = await fetch(this.url(path), { headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/pdf' } });
    if (!res.ok) throw new Error(`DocuSign download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  downloadSigned(envelopeId: string) { return this.bytes(`/envelopes/${encodeURIComponent(envelopeId)}/documents/combined`); }
  downloadCertificate(envelopeId: string) { return this.bytes(`/envelopes/${encodeURIComponent(envelopeId)}/documents/certificate`); }
}

// Development and UAT: nothing leaves the API. Signing happens through the dev-only mock endpoints, and the
// "signed PDF" and certificate are generated by the API (see services/envelopes.ts).
class MockDocuSign implements DocuSign {
  readonly mode = 'mock' as const;
  async createEnvelope(): Promise<string> { return 'mock-' + randomUUID(); }
  async getStatus(): Promise<null> { return null; }
  async voidEnvelope(): Promise<void> { /* nothing to call */ }
  async downloadSigned(): Promise<null> { return null; }
  async downloadCertificate(): Promise<null> { return null; }
}
