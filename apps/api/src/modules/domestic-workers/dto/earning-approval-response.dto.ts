import { DomesticWorkerEarningApproval, DomesticWorkerEarningApprovalStatus } from '../entities/domestic-worker-earning-approval.entity';

export interface EarningApprovalResponseDto {
  id: string;
  booking_id: string;
  worker_user_id: string;
  worker_name: string | null;
  source_key: string;
  amount_cents: number;
  status: DomesticWorkerEarningApprovalStatus;
  booking_number: string | null;
  booking_type: string | null;
  booking_status: string | null;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export function toEarningApprovalResponseDto(row: DomesticWorkerEarningApproval): EarningApprovalResponseDto {
  return {
    id: row.id,
    booking_id: row.bookingId,
    worker_user_id: row.workerUserId,
    worker_name: row.workerUser?.fullName ?? null,
    source_key: row.sourceKey,
    amount_cents: row.amountCents,
    status: row.status,
    booking_number: row.booking?.bookingNumber ?? null,
    booking_type: row.booking?.bookingType ?? null,
    booking_status: row.booking?.status ?? null,
    reviewed_by_user_id: row.reviewedByUserId,
    reviewed_by_name: row.reviewedByUser?.fullName ?? null,
    reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejection_reason: row.rejectionReason,
    created_at: row.createdAt.toISOString(),
  };
}
