// مطابق لـ apps/api/src/modules/payments/dto/payments-response.dto.ts وentities/payout.entity.ts
export type PayoutMethod = 'bank_transfer' | 'vodafone_cash' | 'instapay' | 'cash';

export type PayoutStatus = 'requested' | 'under_review' | 'approved' | 'processing' | 'completed' | 'rejected' | 'failed';

export interface AdminPayoutResponseDto {
  id: string;
  payout_number: string;
  amount_cents: number;
  net_amount_cents: number;
  payout_method: PayoutMethod;
  payout_status: PayoutStatus;
  requested_at: string;
  completed_at: string | null;
  technician_code: string;
  technician_name: string;
  technician_user_id: string;
  rejection_reason: string | null;
}

export interface RejectPayoutBody {
  reason: string;
}

export interface PayoutOrderItemResponseDto {
  order_id: string;
  earning_cents: number;
  commission_cents: number;
}

export interface RefundOrderBody {
  reason_notes: string;
  amount_cents?: number;
  payment_id?: string;
}

// مطابق لـ apps/api/src/modules/payments/entities/payment.entity.ts — الملخص المالي لكل طلب
// (docs/08 §20 بند 11).
export type PaymentMethod = 'cash' | 'card' | 'wallet' | 'bank_transfer' | 'corporate_credit' | 'fawry_reference' | 'instapay';

export type PaymentGatewayStatus =
  | 'pending'
  | 'processing'
  | 'manual_review'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'refunded'
  | 'partially_refunded';

// مطابق لـ apps/api/src/modules/payments/entities/refund.entity.ts
export type RefundType = 'full' | 'partial';
export type RefundMethod = 'original_method' | 'wallet_credit' | 'cash';
export type RefundStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'rejected';

// مطابق لـ apps/api/src/modules/orders/dto/order-financial-summary-response.dto.ts —
// GET /admin/orders/:id/financial-summary (docs/08 §20 بند 11): كانت فجوة عرض حقيقية —
// عمولة المنصة/أرباح الفني محسوبة ومخزّنة على الطلب من زمان بس صفر endpoint كان بيرجّعها.
export interface OrderPaymentSummaryDto {
  id: string;
  payment_method: PaymentMethod;
  payment_status: PaymentGatewayStatus;
  amount_cents: number;
  completed_at: string | null;
  // غير null = محاولة تحصيل شغل إضافي معتمد (docs/08 §21)، مش دفعة الطلب الأصلية.
  order_item_batch_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  // InstaPay بس — العميل قال إنه حوّل فعليًا (مش تأكيد نهائي، ده لسه بيتم من الأدمن).
  customer_confirmed_transfer_at: string | null;
}

export interface OrderRefundSummaryDto {
  id: string;
  amount_cents: number;
  refund_type: RefundType;
  refund_method: RefundMethod;
  refund_status: RefundStatus;
  completed_at: string | null;
}

/**
 * **سجل تحويلات InstaPay** (طلب مالك 2026-09-10) — مش طابور المعلّق بس.
 *
 * > «موجود إنستا باي لما بتيجي تعمل تأكيد إن الدفع وصل، خلاص كده بعد ما تتأكد التحويلة دي
 * >  بتختفي من السيستم. لأ عايزها عادي تظهر، ولكن تظهر إن هي معمول لها Accepted فعلاً وتظهر
 * >  بتاريخ إيه وتفاصيل زيادة كمان. معلومات الفلوس دي لازم تكون دقيقة جدًا.»
 *
 * الاستعلام القديم كان بيفلتر `payment_status = 'pending'` فقط، فالتحويلة كانت **تختفي** لحظة
 * التأكيد ومفيش أي أثر مرئي — لا للمراجعة ولا للتدقيق. الشكل ده بيحمل الخط الزمني كامل
 * (بدأت → العميل بلّغ → القرار)، مين قرّر، وسبب الرفض، مع أرقام الفلوس الدقيقة.
 */
export interface InstaPayPaymentResponseDto {
  id: string;
  payment_number: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  /** مبلغ التحويلة نفسها بالقرش. */
  amount_cents: number;
  currency_code: string;
  /** إجمالي الطلب وقت القراءة — التحويلة ممكن تكون عربون أو قسط، فالمقارنة لازمة للمراجعة. */
  order_total_amount_cents: number;
  /** حالة دفع الطلب ككل (`unpaid`/`paid`/…) — بتوضّح هل التحويلة دي غطّت الطلب ولا لأ. */
  order_payment_status: string;
  /** `pending` \| `succeeded` \| `failed` — الحالة الفعلية للدفعة. */
  payment_status: string;
  gateway_reference: string | null;
  initiated_at: string;
  customer_confirmed_transfer_at: string | null;
  /** لحظة القرار: `completed_at` للمقبولة، `failed_at` للمرفوضة، `null` للمعلّقة. */
  decided_at: string | null;
  /** اسم الموظف اللي أكّد/رفض — من `collected_by_user_id`. */
  decided_by_name: string | null;
  /** سبب الرفض كما سجّله الموظف. `null` لأي حالة تانية. */
  failure_message: string | null;
  /** إجمالي ما اتردّ من التحويلة دي (استرداد مكتمل بس) — عشان الرقم المعروض يبقى صافي فعلاً. */
  refunded_cents: number;
  /** أقساط/دفعات جزئية: معرّف القسط لو التحويلة دي بتخصّه. */
  installment_id: string | null;
}

export interface OrderFinancialSummaryResponseDto {
  total_amount_cents: number;
  /** كل ما دفعه العميل فعليًا حتى الآن، شامل الأقساط المحصلة، بعد الاستردادات المكتملة. */
  paid_amount_cents: number;
  /** دفعات الطلب المباشرة فقط (إيداع/كارت/كاش)، بعد الاستردادات؛ لا تشمل تحصيل الأقساط. */
  direct_paid_amount_cents: number;
  refunded_amount_cents: number;
  /** أصل سعر الطلب الذي غطته خطة تقسيط معتمدة وتتحمل المنصة تحصيله لاحقًا. */
  financed_order_amount_cents: number;
  /** مديونية العميل المتبقية في جدول التقسيط، وليست مبلغًا يجوز للفني تحصيله كاش. */
  installment_outstanding_cents: number;
  /** الرقم الوحيد الذي يجوز للفني طلبه من العميل عند إنهاء الزيارة. */
  amount_due_to_technician_cents: number;
  platform_commission_cents: number;
  technician_earning_cents: number;
  cancellation_fee_cents: number;
  payments: OrderPaymentSummaryDto[];
  refunds: OrderRefundSummaryDto[];
}

export interface WalletResponseDto {
  balance_cents: number;
  pending_balance_cents: number;
  reserved_balance_cents: number;
  total_earned_cents: number;
  total_withdrawn_cents: number;
  currency_code: string;
  is_frozen: boolean;
}

export interface WalletTransactionResponseDto {
  id: string;
  transaction_number: string;
  direction: string;
  transaction_type: string;
  amount_cents: number;
  balance_after_cents: number;
  description_ar: string | null;
  is_reversed: boolean;
  created_at: string;
}

export interface AdminWalletDetailResponseDto {
  wallet: WalletResponseDto;
  transactions: WalletTransactionResponseDto[];
}
