// Status of one training assignment. Same order of checks as the prototype (Q.trStatus).

export type TrainingStatus = 'Correction' | 'Corrected' | 'Obsolete' | 'Superseded' | 'Withdrawn' | 'Complete' | 'Left' | 'Overdue' | 'Assigned';

export interface AssignmentFacts {
  isCorrection: boolean;          // this record corrects another and needs no retraining
  hasCorrections: boolean;        // a later record corrects this one
  effectiveVersionId: string | null;
  versionId: string;
  withdrawn: boolean;
  completedAt: Date | null;
  userLeft: boolean;
  dueAt: Date;
}

export function trainingStatus(a: AssignmentFacts, now: Date): TrainingStatus {
  if (a.isCorrection) return 'Correction';
  if (a.hasCorrections) return 'Corrected';
  if (a.effectiveVersionId === null) return 'Obsolete';
  if (a.effectiveVersionId !== a.versionId) return 'Superseded';
  if (a.withdrawn) return 'Withdrawn';
  if (a.completedAt) return 'Complete';
  if (a.userLeft) return 'Left';
  return startOfUtcDay(a.dueAt) < startOfUtcDay(now) ? 'Overdue' : 'Assigned';
}

const startOfUtcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
