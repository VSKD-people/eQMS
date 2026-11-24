# 03 · API contract (Phase 1)

The API is the only thing that touches the database. The web app calls it from its server (never from the
browser), passing the signed-in user's Microsoft Entra ID access token. All JSON; dates are ISO 8601 UTC strings.

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <Entra access token for the API>` (audience = the API app registration).
  Development only (`DEV_AUTH=1` and `NODE_ENV` not `production`): `X-Dev-User: dev-vic` picks a seeded persona.
- Errors: `{ "error": { "code": "conflict", "message": "Plain-English reason" } }` with 400, 401, 403, 404, 409 or 500.
  Database rule violations (locked records, allowance used up, segregation of duties) come back as 409 or 403 with
  the rule's message.
- Every request runs in one database transaction with the tenant and the acting user set (row-level security).

## Shared shapes

```ts
type Person = { id: string; name: string };
type Role = 'admin' | 'qm' | 'author' | 'reviewer' | 'approver' | 'process' | 'employee' | 'auditor';

type Me = { user: { id: string; name: string; email: string; initials: string; jobTitle: string | null; roles: Role[]; groups: string[]; clearance: string };
            permissions: string[]; tenant: { id: string; name: string };
            via: 'Microsoft 365 single sign-on' | 'Development sign-in'; esignMode: 'live' | 'mock' };

type Task = { id: string; kind: 'esign' | 'send-approval' | 'training' | 'review-doc' | 'author' | 'resubmit' | 'effectiveness' | 'qe-assess' | 'fyi' | string;
              recordType: 'document' | 'capa' | 'quality_event'; recordId: string; recordNumber: string; title: string;
              dueAt: string | null; note: string | null; ref: string | null; fyi: boolean };

type DocumentSummary = { id: string; number: string; title: string; docType: string; state: string; classification: string;
                         owner: Person; currentVersion: string; effectiveVersion: string | null; updatedAt: string };

type Audience = { groups: string[]; roles: Role[]; users: Person[]; daysToComplete: number; quiz: boolean };

type Signer = { userId: string; name: string; roleLabel: string; meaning: 'Authored' | 'Reviewed' | 'Approved'; routingOrder: number;
                status: 'waiting' | 'sent' | 'signed' | 'declined' | 'cancelled'; signedAt: string | null };

type AgreementSummary = { id: string; providerAgreementId: string | null; recordType: string; recordNumber: string; version: string | null;
                         subject: string; purpose: string; status: 'sent' | 'completed' | 'declined' | 'cancelled';
                         sentBy: Person; sentAt: string; completedAt: string | null; transactionNo: number; allowanceYear: number;
                         signed: number; signers: Signer[]; correctionOf: string | null; reason: string | null };

type Agreement = AgreementSummary & {
  verification: { footer: true; version: true; documentId: true; dates: true; note: string; by: string; at: string };
  events: { at: string; type: string; user: Person | null; detail: string | null; source: 'app' | 'webhook' | 'poll' }[];
  files: { original: { sha256: string }; signed: { sha256: string } | null; auditReport: { sha256: string } | null };
};

type Allowance = { allowance: number; used: number; remaining: number; low: boolean; exhausted: boolean; year: number; from: string; to: string };

type TrainingRecord = { id: string; user: Person; documentId: string; documentNumber: string; title: string; version: string;
                        allocatedBy: Person | null /* null = System */; allocReason: string; assignedAt: string; dueAt: string | null;
                        completedAt: string | null; statement: string | null; quizResult: string | null; via: string | null;
                        agreementId: string | null; correctionOf: string | null; correctionReason: string | null; noRetrain: boolean;
                        closedAt: string | null; closedReason: string | null;
                        status: 'Assigned' | 'Overdue' | 'Complete' | 'Superseded' | 'Withdrawn' | 'Corrected' | 'Correction' | 'Obsolete' };

type AuditEntry = { seq: number; at: string; actor: string; action: string; objectType: string; objectId: string; summary: string; before: unknown; after: unknown };
```

## Endpoints

### Session, tasks, people
| Method | Path | Who | Returns |
|---|---|---|---|
| GET | `/health` (no auth, no prefix) | anyone | `{ ok: true }` |
| GET | `/ready` (no auth, no prefix) | anyone | `{ ok: true }` once the database answers |
| GET | `/me` | signed in | `Me` |
| GET | `/tasks` | signed in | `Task[]` (open, assigned to me) |
| GET | `/notifications` | signed in | `{ id, kind, title, body, href, createdAt, readAt }[]` |
| POST | `/notifications/:id/read` | signed in | `204` |
| GET | `/users` | signed in | qm, admin, auditor, process: `{ id, name, email, jobTitle, status, roles, groups, clearance }[]` (everyone). Others: `{ id, name, jobTitle, status, roles, groups }[]`, active people only, for picking reviewers, approvers and audiences |
| GET | `/users/:id` | self, training.org, admin.users | `{ id, name, email, jobTitle, status, roles, groups, clearance, managerId }` |
| GET | `/groups` | signed in | `{ id, name, description, members: number }[]` |

### Users and roles (admin.users)
Nobody changes their own roles, groups or access. A System Administrator can't also hold Approver or Quality
Manager (segregation of duties). Every change is audited with old and new values and reconciles training at once.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/users` | `{ email, name, jobTitle?, roles: Role[], groups: string[], managerId?, clearance? }` | `{ id, training: { added, closed } }` (for tenants without SCIM) |
| PUT | `/users/:id/roles` | `{ roles: Role[], reason }` | `{ roles, training }` (the person is notified) |
| PUT | `/users/:id/groups` | `{ groups: string[] }` (group names) | `{ groups, training }` |
| PUT | `/users/:id/status` | `{ status: 'active'|'revoked'|'left', reason }` | `{ status, training }`. Revoked or left also ends every session at once |
| POST | `/users/:id/revoke-sessions` | | `{ ok: true }` (tokens issued before now are refused) |

### Documents (Route 1 starts here)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/documents?state=&type=&q=` | | `DocumentSummary[]` (classification-filtered) |
| GET | `/document-types` | | `{ type, prefix }[]` |
| POST | `/documents` | `{ docType, title, classification, ownerId, process, tags?, audience? }` | `{ id, number }` |
| GET | `/documents/:number` | | document detail (below) |
| PUT | `/documents/:number/draft` | `{ content: {t:'h'|'p', x:string}[], summary }` | `204` (draft only) |
| POST | `/documents/:number/submit` | `{ reviewers: string[], approvers: string[] }` | `204` → In review, or Review closed if no reviewers |
| POST | `/documents/:number/review` | `{ comment? }` | `204` (last reviewer closes review) |
| POST | `/documents/:number/send-back` | `{ reason }` | `204` → Draft |
| POST | `/documents/:number/versions` | `{ kind: 'major'|'minor', summary }` | `{ version }` |
| GET | `/documents/:number/approval-plan?approvers=id,id` | | `{ subject, signers: Signer[], problems: string[], allowance: Allowance }` |
| POST | `/documents/:number/agreements` | `{ verification: { footer, version, documentId, dates, note? }, approvers: string[] }` | `AgreementSummary` (one transaction) |
| PUT | `/documents/:number/audience` | `{ groups, roles, users: string[], daysToComplete, quiz }` | `{ added, closed }` |
| GET | `/documents/:number/pdf?version=` | | `application/pdf` (the exact PDF that goes into the agreement) |
| GET | `/documents/:number/training?all=1` | | `TrainingRecord[]` for the effective version (all versions with `all=1`) |
| GET | `/documents/:number/quiz` | | `{ questions: { q: string; options: string[] }[] }` (no answers) |

Document detail:
```ts
{ id, number, title, docType, state, classification, process, tags, owner: Person, author: Person, effectiveAt, approvalDue,
  versions: { id, version, kind, state, summary, createdAt, approvedAt, agreementId, migratedFrom }[],
  current: { version, state, summary, content: { t: 'h'|'p'; x: string }[], contentSha256 },
  reviewers: { user: Person; status; reviewedAt }[], approvers: { user: Person; position: 1|2; status }[],
  audience: Audience, agreement: AgreementSummary | null /* open or most recent */,
  can: { edit, submit, review, sendBack, send, sign, cancel, newVersion, changeAudience: boolean } }
```

### CAPA and deviation closure (Route 1)
Phase 1 has the closure path only. The full CAPA and quality event screens are Phase 2.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/capas`, `/capas/:number` | | `{ id, number, title, state, severity, owner, problem, effectivenessCriteria, effectivenessResult, effectivenessVerdict, effectivenessAt, closedAt, agreement: AgreementSummary | null }` |
| GET | `/quality-events`, `/quality-events/:number` | | `{ id, number, type, title, state, severity, owner, description, assessment, closureJustification, closedAt, agreement }` |
| GET | `/capas/:number/pdf?approver=`, `/quality-events/:number/pdf?approver=` | | `application/pdf`: the closure PDF as it would go into the agreement |
| POST | `/capas/:number/effectiveness` | `{ result, verdict: 'Effective'|'Not effective' }` | `204`. Effective: ready to send the closure. Not effective: back to Execution for more actions. Refused while a closure agreement is out |
| GET | `/capas/:number/approval-plan?approver=` | | as for documents |
| POST | `/capas/:number/agreements` | `{ verification, approverId }` | `AgreementSummary` |
| POST | `/quality-events/:number/closure` | `{ justification }` | `204` (deviations only) |
| GET | `/quality-events/:number/approval-plan?approver=` | | as for documents |
| POST | `/quality-events/:number/agreements` | `{ verification, approverId }` | `AgreementSummary` |

### Agreements, approvals register, Adobe Sign
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/signing/allowance` | | `Allowance` (Adobe Sign transactions this allowance year) |
| GET | `/agreements?year=&status=&record=` | | `{ allowance: Allowance; items: AgreementSummary[] }`. The whole transactions log needs approvals.view; `record=POL-004` (one record's agreements) is open to anyone who can see that record |
| GET | `/agreements/:id` | | `Agreement` |
| POST | `/agreements/:id/cancel` | `{ reason }` | `AgreementSummary` (record returns with the reason) |
| POST | `/agreements/:id/refresh` | | `AgreementSummary` (polls Adobe Sign: fallback for a missed webhook) |
| GET | `/agreements/:id/files/:kind` | kind = `original` · `signed` · `audit-report` | `application/pdf` |
| GET | `/approvals/register` | | `AgreementSummary[]` (completed approvals) |
| GET, POST | `/webhooks/adobe-sign/:token` (no prefix, no bearer) | Adobe Sign webhook notification (POST) or verification of intent (GET) | `200` with the `X-AdobeSign-ClientId` echoed (header and `{ xAdobeSignClientId }`) when the token and client ID match; plain `404` otherwise. The API then reads the agreement from Adobe Sign and acts on that |
| POST | `/agreements/:id/mock/sign` | | `AgreementSummary`. **Mock mode only** (`ADOBE_SIGN_MODE=mock`): signs as the caller when it is their turn; `403` in live mode |
| POST | `/agreements/:id/mock/decline` | `{ reason }` | `AgreementSummary`. Mock mode only |

Signers sign in Adobe Sign from the Adobe Sign email (remote signing). In live mode the app shows status only; it
never signs on anyone's behalf. The mock endpoints exist so development and UAT can walk the whole route without a
Adobe Sign account.

### Training (Route 2)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/training/my` | | `{ open: TrainingRecord[]; history: TrainingRecord[] }` |
| POST | `/training/records/:id/complete` | `{ confirm: true, quizAnswers?: number[] }` | `TrainingRecord` (trainee only; system time) |
| GET | `/training/records?userId=&documentNumber=&status=&all=1` | | `TrainingRecord[]` (training.org). Without `status`, only live records unless `all=1`; with `status`, every record in that status |
| GET | `/training/records/:id` | | `{ record: TrainingRecord; corrections: TrainingRecord[]; audit: AuditEntry[] }` |
| POST | `/training/records/:id/corrections` | `{ reason, retrain: boolean }` | `TrainingRecord` (Quality Manager) |
| GET | `/training/matrix?group=` | | `{ documents: {id, number, title, currentVersion}[]; people: {id, name, jobTitle}[]; cells: Record<userId, Record<documentId, { status, versionTrained, currentVersion, recordId } | null>> }` |
| POST | `/training/reminders` | | `{ sent, overdue }` (Quality Manager; also run daily by the scheduled job) |

### Reports, audit, settings
| Method | Path | Returns |
|---|---|---|
| GET | `/reports/:name.:format` name = `training-matrix` · `training-records` · `document-status` · `approvals-register` · `signing-transactions`; format = `xlsx` · `pdf`; same query filters as the screens | file, stamped "Generated (UTC) … by …", export logged |
| GET | `/audit?objectType=&objectId=&action=&before=&limit=` | `AuditEntry[]` newest first (audit.read; `before` = seq for paging; viewing is itself logged). Object types: Document, CAPA, Quality event, Training record, Training, User, Group, Settings, Report, Audit trail |
| GET | `/audit/verify` | `{ ok, entries, brokenAt }` |
| GET / PUT | `/settings` | `{ signingAllowance, allowanceYearStartMonth, allowanceWarnAt, ackStatement, reminderDays, overdueRepeatDays }` (PUT: qm, admin; logged with old and new values). `ackStatement` must contain `{doc}` and `{version}`. GET also returns `signingGoLive` and `signatureStatement` (read-only) |

### SCIM 2.0 for Entra ID provisioning (no prefix)
`/scim/v2/Users` (GET with `filter=userName eq "…"`, POST), `/scim/v2/Users/:id` (GET, PATCH, PUT), `/scim/v2/Groups`
(GET, POST), `/scim/v2/Groups/:id` (GET, PATCH members), `DELETE /scim/v2/Users/:id` (marks a leaver; nothing is
deleted). Bearer = the SCIM secret from Key Vault. New users get the Employee role; other roles are granted in VeQMS.
`active: false` revokes access and ends sessions. Creating a user,
changing groups or deactivating a user reconciles training at once (new starters get every current version their
audience needs; leavers' open items close, records kept). Run Microsoft's SCIM validator before go-live.

## Configuration

API (`apps/api`), from environment variables (Key Vault references in Azure):

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the `veqms_app` login (no password with Entra auth) |
| `DATABASE_ENTRA_AUTH` | `1` to use the managed identity's token as the password (Azure Database for PostgreSQL) |
| `ENTRA_TENANT_ID` | Directory (tenant) ID |
| `ENTRA_API_AUDIENCE` | API app registration's Application ID URI or client ID |
| `DEV_AUTH` | `1` enables `X-Dev-User` (refused when `NODE_ENV=production`) |
| `ADOBE_SIGN_MODE` | `live` or `mock` (mock: nothing goes to Adobe Sign; signers act through the mock endpoints; development and UAT only; refused in production) |
| `ADOBE_SIGN_AUTH` | `oauth` (OAuth app and refresh token) or `integration-key` (Enterprise integration key) |
| `ADOBE_SIGN_API_ACCESS_POINT` | The account's API address, e.g. `https://api.eu1.adobesign.com/`. Required for `oauth`; discovered for an integration key if empty |
| `ADOBE_SIGN_DISCOVERY_URL` | Where to discover the API address: `https://api.adobesign.com` (default) or `https://api.adobesignsandbox.com` |
| `ADOBE_SIGN_CLIENT_ID`, `ADOBE_SIGN_CLIENT_SECRET`, `ADOBE_SIGN_REFRESH_TOKEN` | OAuth app and refresh token (secret and token in Key Vault) |
| `ADOBE_SIGN_INTEGRATION_KEY` | Enterprise integration key (Key Vault) |
| `ADOBE_SIGN_WEBHOOK_TOKEN` | 32+ random characters in the webhook URL (Key Vault). Required in live mode |
| `ADOBE_SIGN_WEBHOOK_CLIENT_ID` | Expected `X-AdobeSign-ClientId` on webhooks; defaults to `ADOBE_SIGN_CLIENT_ID` |
| `STORAGE_MODE` | `azure` or `local` |
| `STORAGE_ACCOUNT_URL`, `STORAGE_CONTAINER` | Blob storage for PDFs, signed PDFs and audit reports (immutable container) |
| `LOCAL_STORAGE_DIR` | folder for `local` mode |
| `SCIM_TOKEN` | bearer secret for the SCIM endpoint |
| `GRAPH_MAIL_FROM` | shared QMS mailbox for email notifications (empty = in-app only) |
| `APP_BASE_URL` | web app address, for links in notifications |
| `PORT` | default 8080 |
| `DATABASE_SSL` | `1` to require TLS without Entra auth (Entra auth always uses TLS) |
| `LOG_LEVEL` | default `info` |

Web (`apps/web`):

| Variable | Meaning |
|---|---|
| `API_BASE_URL` | internal address of the API (e.g. `http://veqms-api` inside Container Apps) |
| `ENTRA_TENANT_ID`, `ENTRA_WEB_CLIENT_ID`, `ENTRA_WEB_CLIENT_SECRET` | web app registration (confidential client, auth code + PKCE) |
| `ENTRA_API_SCOPE` | e.g. `api://<api-client-id>/access_as_user` |
| `SESSION_SECRET` | 32+ random bytes, base64; encrypts the session cookie |
| `APP_BASE_URL` | public address, for the redirect URI `/auth/callback` |
| `DEV_AUTH` | `1` shows the persona picker instead of Microsoft sign-in (never in production) |
