import { DomesticWorkerEarningApproval, DomesticWorkerEarningApprovalStatus } from '../entities/domestic-worker-earning-approval.entity';

export interface EarningApprovalResponseDto {
  id: string;
  booking_id: string;
  worker_user_id: string;
  amount_cents: number;
  status: DomesticWorkerEarningApprovalStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export function toEarningApprovalResponseDto(row: DomesticWorkerEarningApproval): EarningApprovalResponseDto {
  return {
    id: row.id,
    booking_id: row.bookingId,
    worker_user_id: row.workerUserId,
    amount_cents: row.amountCents,
    status: row.status,
    reviewed_by_user_id: row.reviewedByUserId,
    reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejection_reason: row.rejectionReason,
    created_at: row.createdAt.toISOString(),
  };
}
