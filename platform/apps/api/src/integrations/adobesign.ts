// Adobe Sign (Adobe Acrobat Sign REST API v6) client, plus a mock for development and UAT.
//
// What VeQMS needs from Adobe Sign: send one agreement per sign-off with every signer in order, read back who has
// signed or declined and when, cancel an agreement with a reason, and download the signed PDF and the audit report.
//
// VERIFY before go-live, against Adobe's v6 API reference (secure.<shard>.adobesign.com/public/docs/restapi/v6) and
// developer guide. This client was written from Adobe's published guides without access to an Adobe Sign account:
// - transient document upload: multipart part names (File, File-Name, Mime-Type) and the transientDocumentId reply;
// - POST /agreements: participantSetsInfo with `order` (reviewers share an order to sign in parallel: hybrid routing),
//   role SIGNER, signatureType ESIGN, state IN_PROCESS, externalId {id};
// - GET /agreements/{id} `status`, GET /agreements/{id}/events (`type`, `date`, `participantEmail`, `comment`);
// - PUT /agreements/{id}/state with state CANCELLED (Adobe's pages also show CANCELED) and agreementCancellationInfo;
// - GET /agreements/{id}/combinedDocument and /auditTrail (binary PDF);
// - OAuth refresh at {apiAccessPoint}oauth/v2/refresh, and GET /baseUris for the account's data centre.
// Part 11: identity check at signing and the reason for signing come from the Bio-Pharma settings of the group the
// agreements are sent from. Check whether the API can choose that group per agreement; until then, the integration's
// user must send from (belong to) that group.
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.ts';

export interface SignParticipant { email: string; name: string; order: number; meaning: string; roleLabel: string }
export interface CreateAgreement { name: string; pdf: Uint8Array; fileName: string; participants: SignParticipant[]; veqmsAgreementId: string; message: string }
export interface ParticipantOutcome { email: string; outcome: 'signed' | 'declined'; at: string | null; comment: string | null }
export interface AgreementState { status: string; cancelComment: string | null; outcomes: ParticipantOutcome[] }

export interface ESign {
  readonly mode: 'live' | 'mock';
  createAgreement(a: CreateAgreement): Promise<string>;
  getState(agreementId: string): Promise<AgreementState | null>; // null in mock mode: the database is the state
  cancelAgreement(agreementId: string, reason: string): Promise<void>;
  downloadSigned(agreementId: string): Promise<Uint8Array | null>;
  downloadAuditReport(agreementId: string): Promise<Uint8Array | null>;
  // Signs in once (OAuth: uses the refresh token). The daily job calls it so the refresh token, which Adobe expires
  // after 60 days unused, stays alive in quiet periods, and so a revoked credential shows up as a failed job.
  checkSignIn(): Promise<void>;
}

export function createAdobeSign(cfg: Config): ESign {
  return cfg.ADOBE_SIGN_MODE === 'live' ? new LiveAdobeSign(cfg) : new MockAdobeSign();
}

type Json = Record<string, unknown>;

class LiveAdobeSign implements ESign {
  readonly mode = 'live' as const;
  private token: { value: string; expires: number } | null = null;
  private accessPoint: string | null;
  private readonly cfg: Config;
  constructor(cfg: Config) {
    this.cfg = cfg;
    this.accessPoint = cfg.ADOBE_SIGN_API_ACCESS_POINT ? cfg.ADOBE_SIGN_API_ACCESS_POINT.replace(/\/?$/, '/') : null;
  }

  // Integration key: a long-lived bearer token. OAuth: an access token (about an hour) from the stored refresh token.
  // Adobe expires a refresh token after 60 days unused; this API uses it far more often than that.
  private async accessToken(): Promise<string> {
    if (this.cfg.ADOBE_SIGN_AUTH === 'integration-key') return this.cfg.ADOBE_SIGN_INTEGRATION_KEY;
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`${await this.base()}oauth/v2/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.cfg.ADOBE_SIGN_REFRESH_TOKEN, client_id: this.cfg.ADOBE_SIGN_CLIENT_ID, client_secret: this.cfg.ADOBE_SIGN_CLIENT_SECRET })
    });
    if (!res.ok) throw new Error(`Adobe Sign sign-in failed (${res.status}). Check the client ID, secret and refresh token.`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  // The account's data centre. With an integration key it can be discovered; OAuth needs it configured.
  private async base(): Promise<string> {
    if (this.accessPoint) return this.accessPoint;
    const res = await fetch(`${this.cfg.ADOBE_SIGN_DISCOVERY_URL.replace(/\/$/, '')}/api/rest/v6/baseUris`, { headers: { authorization: `Bearer ${this.cfg.ADOBE_SIGN_INTEGRATION_KEY}`, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Adobe Sign base URI discovery failed (${res.status})`);
    const j = (await res.json()) as { apiAccessPoint: string };
    this.accessPoint = j.apiAccessPoint.replace(/\/?$/, '/');
    return this.accessPoint;
  }

  private async call(method: string, path: string, body?: unknown, accept = 'application/json'): Promise<Response> {
    const init: RequestInit = { method, headers: { authorization: `Bearer ${await this.accessToken()}`, accept } };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['content-type'] = 'application/json'; }
    const res = await fetch(`${await this.base()}api/rest/v6${path}`, init);
    if (!res.ok) throw new Error(`Adobe Sign ${method} ${path.split('?')[0]} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async createAgreement(a: CreateAgreement): Promise<string> {
    const form = new FormData();
    form.append('File-Name', a.fileName);
    form.append('Mime-Type', 'application/pdf');
    form.append('File', new Blob([Buffer.from(a.pdf)], { type: 'application/pdf' }), a.fileName);
    const doc = (await (await this.call('POST', '/transientDocuments', form)).json()) as { transientDocumentId: string };
    const res = await this.call('POST', '/agreements', {
      fileInfos: [{ transientDocumentId: doc.transientDocumentId }],
      name: a.name,
      message: a.message,
      signatureType: 'ESIGN',
      state: 'IN_PROCESS',
      externalId: { id: a.veqmsAgreementId },
      // One participant set per signer. Equal `order` values sign in parallel (reviewers); verify hybrid routing.
      participantSetsInfo: a.participants.map((p) => ({ order: p.order, role: 'SIGNER', memberInfos: [{ email: p.email }] }))
    });
    return ((await res.json()) as { id: string }).id;
  }

  async getState(agreementId: string): Promise<AgreementState> {
    const id = encodeURIComponent(agreementId);
    const ag = (await (await this.call('GET', `/agreements/${id}`)).json()) as { status: string };
    const ev = (await (await this.call('GET', `/agreements/${id}/events`)).json()) as { events?: Json[] };
    const outcomes: ParticipantOutcome[] = [];
    let cancelComment: string | null = null;
    for (const e of ev.events ?? []) {
      const type = String(e.type ?? '').toUpperCase();
      const email = String(e.participantEmail ?? e.actingUserEmail ?? '').toLowerCase();
      const at = typeof e.date === 'string' ? e.date : null;
      const comment = typeof e.comment === 'string' ? e.comment : null;
      if (type === 'RECALLED' || type === 'CANCELLED') cancelComment = comment ?? cancelComment;
      if (['ESIGNED', 'DIGSIGNED', 'SIGNED', 'APPROVED', 'ACTION_COMPLETED'].includes(type) && email) outcomes.push({ email, outcome: 'signed', at, comment: null });
      if (['REJECTED', 'DECLINED'].includes(type) && email) outcomes.push({ email, outcome: 'declined', at, comment });
    }
    return { status: ag.status, cancelComment, outcomes };
  }

  async cancelAgreement(agreementId: string, reason: string): Promise<void> {
    await this.call('PUT', `/agreements/${encodeURIComponent(agreementId)}/state`, { state: 'CANCELLED', agreementCancellationInfo: { comment: reason.slice(0, 200), notifyOthers: true } });
  }

  private async bytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.call('GET', path, undefined, 'application/pdf')).arrayBuffer());
  }
  downloadSigned(agreementId: string) { return this.bytes(`/agreements/${encodeURIComponent(agreementId)}/combinedDocument`); }
  downloadAuditReport(agreementId: string) { return this.bytes(`/agreements/${encodeURIComponent(agreementId)}/auditTrail`); }
  async checkSignIn(): Promise<void> { this.token = null; await this.accessToken(); await this.base(); }
}

// Development and UAT: nothing leaves the API. Signing happens through the development-only mock endpoints, and the
// "signed PDF" and audit report are generated by the API (see services/agreements.ts).
class MockAdobeSign implements ESign {
  readonly mode = 'mock' as const;
  async createAgreement(): Promise<string> { return 'mock-' + randomUUID(); }
  async getState(): Promise<null> { return null; }
  async cancelAgreement(): Promise<void> { /* nothing to call */ }
  async downloadSigned(): Promise<null> { return null; }
  async downloadAuditReport(): Promise<null> { return null; }
  async checkSignIn(): Promise<void> { /* nothing to sign in to */ }
}
