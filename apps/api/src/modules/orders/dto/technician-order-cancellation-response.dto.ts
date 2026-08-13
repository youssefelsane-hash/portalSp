import { CancellationRecoveryAction, TechnicianOrderCancellation } from '../entities/technician-order-cancellation.entity';

export interface TechnicianOrderCancellationResponseDto {
  id: string;
  technician_id: string;
  cancellation_reason_id: string;
  reason_text: string | null;
  booking_mode: string;
  accepted_at: string;
  cancelled_at: string;
  elapsed_seconds_after_acceptance: number;
  within_policy_window: boolean;
  recovery_action: CancellationRecoveryAction;
  fee_cents: number;
}

export function toTechnicianOrderCancellationResponseDto(row: TechnicianOrderCancellation): TechnicianOrderCancellationResponseDto {
  return {
    id: row.id,
    technician_id: row.technicianId,
    cancellation_reason_id: row.cancellationReasonId,
    reason_text: row.reasonText,
    booking_mode: row.bookingMode,
    accepted_at: row.acceptedAt.toISOString(),
    cancelled_at: row.cancelledAt.toISOString(),
    elapsed_seconds_after_acceptance: row.elapsedSecondsAfterAcceptance,
    within_policy_window: row.withinPolicyWindow,
    recovery_action: row.recoveryAction,
    fee_cents: row.feeCents,
  };
}
