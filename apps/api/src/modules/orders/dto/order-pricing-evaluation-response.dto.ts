import { ServicePricingEvaluation } from '../../pricing/entities/service-pricing-evaluation.entity';

// للأدمن/التشغيل بس — راجع PricingEngineService.findEvaluationForOrder() (docs/08 §35).
export interface OrderPricingEvaluationResponseDto {
  computed_duration_days: number | null;
  computed_technicians: number | null;
  computed_assistants: number | null;
  field_values: Record<string, unknown>;
  created_at: string;
}

export function toOrderPricingEvaluationResponseDto(
  evaluation: ServicePricingEvaluation,
): OrderPricingEvaluationResponseDto {
  return {
    computed_duration_days: evaluation.computedDurationDays !== null ? Number(evaluation.computedDurationDays) : null,
    computed_technicians: evaluation.computedTechnicians,
    computed_assistants: evaluation.computedAssistants,
    field_values: evaluation.fieldValues,
    created_at: evaluation.createdAt.toISOString(),
  };
}
