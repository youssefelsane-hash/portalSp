import { CancellationReason } from '../entities/cancellation-reason.entity';

export interface CancellationReasonResponseDto {
  id: string;
  reason_ar: string;
  reason_en: string;
  applies_to: string;
  charges_fee: boolean;
  fee_percentage: number;
  affects_technician_score: boolean;
  display_order: number;
  is_active: boolean;
  requires_free_text: boolean;
}

export function toCancellationReasonResponseDto(reason: CancellationReason): CancellationReasonResponseDto {
  return {
    id: reason.id,
    reason_ar: reason.reasonAr,
    reason_en: reason.reasonEn,
    applies_to: reason.appliesTo,
    charges_fee: reason.chargesFee,
    fee_percentage: Number(reason.feePercentage),
    affects_technician_score: reason.affectsTechnicianScore,
    display_order: reason.displayOrder,
    is_active: reason.isActive,
    requires_free_text: reason.requiresFreeText,
  };
}
