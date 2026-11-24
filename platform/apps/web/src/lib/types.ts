// Response shapes from the VeQMS API (docs/03-api.md). Keep in step with the API.
import type { Role } from '@veqms/domain';

export type Person = { id: string; name: string };

export type Me = {
  user: { id: string; name: string; email: string; initials: string; jobTitle: string | null; roles: Role[]; groups: string[]; clearance: string };
  permissions: string[];
  tenant: { id: string; name: string };
  esignMode?: 'live' | 'mock';   // 'mock' only in development (ADOBE_SIGN_MODE=mock)
};

export type Task = {
  id: string; kind: string; recordType: 'document' | 'capa' | 'quality_event'; recordId: string; recordNumber: string; title: string;
  dueAt: string | null; note: string | null; ref: string | null; fyi: boolean;
};

export type DocumentSummary = {
  id: string; number: string; title: string; docType: string; state: string; classification: string;
  owner: Person; currentVersion: string; effectiveVersion: string | null; updatedAt: string;
};

export type Audience = { groups: string[]; roles: Role[]; users: Person[]; daysToComplete: number; quiz: boolean };

export type Signer = {
  userId: string; name: string; roleLabel: string; meaning: 'Authored' | 'Reviewed' | 'Approved'; routingOrder: number;
  status: 'waiting' | 'sent' | 'signed' | 'declined' | 'cancelled'; signedAt: string | null;
};

export type AgreementSummary = {
  id: string; providerAgreementId: string | null; recordType: string; recordNumber: string; version: string | null;
  subject: string; purpose: string; status: 'sent' | 'completed' | 'declined' | 'cancelled';
  sentBy: Person; sentAt: string; completedAt: string | null; transactionNo: number; allowanceYear: number;
  signed: number; signers: Signer[]; correctionOf: string | null; reason: string | null;
};

export type Agreement = AgreementSummary & {
  verification: { footer: true; version: true; documentId: true; dates: true; note: string; by: string; at: string };
  events: { at: string; type: string; user: Person | null; detail: string | null; source: 'app' | 'webhook' | 'poll' }[];
  files: { original: { sha256: string }; signed: { sha256: string } | null; auditReport: { sha256: string } | null };
};

export type Allowance = { allowance: number; used: number; remaining: number; low: boolean; exhausted: boolean; year: number; from: string; to: string };

export type Block = { t: 'h' | 'p'; x: string };

export type DocumentDetail = {
  id: string; number: string; title: string; docType: string; state: string; classification: string; process: string; tags: string[];
  owner: Person; author: Person; effectiveAt: string | null; approvalDue: string | null;
  versions: { id: string; version: string; kind: string; state: string; summary: string; createdAt: string; approvedAt: string | null; agreementId: string | null; migratedFrom: string | null }[];
  // pdf: the locked PDF made at submit (its hash is contentSha256); checkedAt: when the author made the four checks.
  current: { version: string; state: string; summary: string; content: Block[]; contentSha256: string; pdf: { sha256: string; checkedAt: string | null } | null;
    retrain: boolean; retrainReason: string | null; changeRequest: { number: string; state: string } | null };
  reviewers: { user: Person; status: string; reviewedAt: string | null }[];
  approvers: { user: Person; position: 1 | 2; status: string; decidedAt: string | null; retrain: boolean | null; retrainReason: string | null }[];
  audience: Audience;
  agreement: AgreementSummary | null;
  can: { edit: boolean; submit: boolean; review: boolean; approve: boolean; sendBack: boolean; sign: boolean; cancel: boolean; newVersion: boolean; changeAudience: boolean };
};

export type ApprovalPlan = { subject: string; signers: Signer[]; problems: string[]; allowance: Allowance };

// GET /capas/:number and /quality-events/:number. `agreement` is the latest closure agreement, if any.
export type ClosureRecord = {
  id: string; number: string; title: string; state: string; severity: string; owner: Person; closedAt: string | null; agreement: AgreementSummary | null;
  effectivenessResult?: string | null; effectivenessVerdict?: string | null; // CAPA
  type?: string; closureJustification?: string | null; // quality event
};

export type TrainingStatus = 'Assigned' | 'Overdue' | 'Complete' | 'Superseded' | 'Withdrawn' | 'Corrected' | 'Correction' | 'Obsolete';

export type TrainingRecord = {
  id: string; user: Person; documentId: string; documentNumber: string; title: string; version: string;
  allocatedBy: Person | null; allocReason: string; assignedAt: string; dueAt: string | null;
  completedAt: string | null; statement: string | null; quizResult: string | null; via: string | null;
  agreementId: string | null; correctionOf: string | null; correctionReason: string | null; noRetrain: boolean;
  closedAt: string | null; closedReason: string | null; status: TrainingStatus;
};

export type AuditEntry = { seq: number; at: string; actor: string; action: string; objectType: string; objectId: string; summary: string; before: unknown; after: unknown };

export type MatrixCell = { status: 'Complete' | 'Assigned' | 'Overdue' | 'Superseded' | 'Not allocated' | 'Not required'; versionTrained: string | null; currentVersion: string; recordId: string | null };

export type Matrix = {
  documents: { id: string; number: string; title: string; currentVersion: string }[];
  people: { id: string; name: string; jobTitle: string | null }[];
  cells: Record<string, Record<string, MatrixCell | null>>;
};

export type UserRow = { id: string; name: string; email: string; jobTitle: string | null; status: string; roles: Role[]; groups: string[] };
export type Group = { id: string; name: string; description: string | null; members: number };
export type Settings = { signingAllowance: number; allowanceYearStartMonth: number; allowanceWarnAt: number; ackStatement: string; reminderDays: number[]; overdueRepeatDays: number };
export type Notification = { id: string; kind: string; title: string; body: string; href: string | null; createdAt: string; readAt: string | null };
