export const WARRANTY_CLAIM_CHANGED_EVENT = 'warranty_claim.changed';

export interface WarrantyClaimChangedEvent {
  claimId: string;
  action: 'opened' | 'reviewed';
  customerProfileId?: string;
  status?: string;
  rejectionReason?: string | null;
  resolutionNotes?: string | null;
}
