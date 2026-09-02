import { Order } from './entities/order.entity';

/**
 * **ADR-0069 — المصدر الوحيد لقرار «هل رسم المعاينة بيترجع بعد زيارة حصلت فعلاً؟».**
 *
 * المسار اللي كشف الفجوة: خدمة معاينة في الموقع مدفوعة مقدمًا → الفني سافر وعاين وسعّر → العميل
 * لغى من `AWAITING_INITIAL_QUOTE_APPROVAL` → المبلغ **كله** بيترجع، بما فيه رسم مقابل زيارة
 * اتعملت. والفني ماخدش ولا مليم (تسوية أرباحه عند `WORK_COMPLETED` بس).
 *
 * ده مختلف جوهريًا عن رسم التقييم **بالصور** اللي المالك قرر صراحة إنه يرجع كامل (docs/08 §115
 * بند 9): الفرق مش «هل الإدارة اشتغلت» — الفرق إن حد **راح المكان**.
 */
export interface AssessmentFeeRefundContext {
  /** فيه عرض سعر مصدره `technician_onsite` على الطلب — الإثبات الدائم إن الزيارة حصلت. */
  onsiteQuoteExists: boolean;
  /** المبلغ اللي اتدفع فعلاً للبوابة ومطلوب استرداده. */
  paidAmountCents: number;
}

export interface AssessmentFeeRefundDecision {
  /** المبلغ اللي هيترجع للعميل فعلاً. */
  refundableCents: number;
  /** المبلغ المحجوز مقابل الزيارة — بيتسجّل في الـaudit صراحة (ADR-0068 §3). */
  withheldCents: number;
}

export function resolveCancellationRefund(
  order: Pick<
    Order,
    'inspectionFeeCents' | 'assessmentType' | 'assessmentFeeRefundableAfterVisitSnapshot'
  >,
  context: AssessmentFeeRefundContext,
): AssessmentFeeRefundDecision {
  const noWithholding = { refundableCents: context.paidAmountCents, withheldCents: 0 };

  if (order.assessmentFeeRefundableAfterVisitSnapshot) return noWithholding;
  // التقييم بالصور مالوش تكلفة ميدانية — قرار المالك إنه يرجع كامل مهما حصل.
  if (order.assessmentType !== 'onsite') return noWithholding;
  if (!context.onsiteQuoteExists) return noWithholding;
  if (order.inspectionFeeCents <= 0) return noWithholding;

  // الحجز مايزيدش عن المدفوع: طلب رسم معاينة بس (بلا شغل) بيتحجز بالكامل ومفيش استرداد.
  const withheldCents = Math.min(order.inspectionFeeCents, context.paidAmountCents);
  return { refundableCents: context.paidAmountCents - withheldCents, withheldCents };
}
