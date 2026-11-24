// Shared types for VeQMS. No runtime dependencies, so both the API and the web app can import them.

export const ROLES = ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee', 'auditor'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'System Administrator',
  qm: 'Quality Manager',
  author: 'Document Owner / Author',
  reviewer: 'Reviewer',
  approver: 'Approver',
  process: 'Process Owner',
  employee: 'Employee / Trainee',
  auditor: 'Auditor (read-only)'
};

export type UserStatus = 'active' | 'revoked' | 'left';
export type Classification = 'Public' | 'Internal' | 'Confidential' | 'Restricted';

export interface UserRef {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  roles: Role[];
  groups: string[]; // group names
}

export const DOC_STATES = ['Draft', 'In review', 'Review closed', 'In approval', 'Effective', 'Superseded', 'Obsolete'] as const;
export type DocState = (typeof DOC_STATES)[number];

export const DOC_TYPES = [
  { type: 'Policy', prefix: 'POL' }, { type: 'Procedure', prefix: 'SOP' }, { type: 'Work instruction', prefix: 'WI' },
  { type: 'Form', prefix: 'FRM' }, { type: 'Register', prefix: 'REG' }, { type: 'Plan', prefix: 'PLN' },
  { type: 'Specification', prefix: 'SPEC' }, { type: 'Statement of Applicability', prefix: 'SOA' }, { type: 'Template', prefix: 'TPL' },
  { type: 'Vendor approval', prefix: 'VEN' }, { type: 'Validation plan', prefix: 'VP' }, { type: 'Validation report', prefix: 'VR' },
  // Signed through Adobe Sign like vendor approvals (PJ, 24 Nov 2026). They replace sign-offs done in Monday.com.
  { type: 'User access review', prefix: 'UAR' }, { type: 'Risk assessment', prefix: 'RA' }
] as const;

export type Meaning = 'Authored' | 'Reviewed' | 'Approved';
export type AgreementStatus = 'sent' | 'completed' | 'declined' | 'cancelled';
export type SignerStatus = 'waiting' | 'sent' | 'signed' | 'declined' | 'cancelled';
export type RecordType = 'document' | 'capa' | 'quality_event';

export interface PlannedSigner {
  userId: string;
  roleLabel: string;
  meaning: Meaning;
  routingOrder: number;
}

export interface Audience {
  groups: string[];
  roles: Role[];
  users: string[];
  daysToComplete: number;
  quiz: boolean;
}

export type TrainingStatus =
  | 'Assigned' | 'Overdue' | 'Complete' | 'Superseded' | 'Withdrawn' | 'Corrected' | 'Correction' | 'Obsolete';

export interface TrainingRecordLike {
  id: string;
  userId: string;
  documentId: string;
  version: string;
  dueAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  correctionOf: string | null;
  noRetrain: boolean;
}
