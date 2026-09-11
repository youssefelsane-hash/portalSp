import { PLATFORM_SYSTEM_USER_ID, Wallet } from '../entities/wallet.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { Payment } from '../entities/payment.entity';
import { Payout } from '../entities/payout.entity';
import { PayoutOrderItem } from '../entities/payout-order-item.entity';
import { Refund, RefundMethod, RefundStatus } from '../entities/refund.entity';
import { SavedPaymentMethod } from '../entities/saved-payment-method.entity';

export interface WalletResponseDto {
  balance_cents: number;
  pending_balance_cents: number;
  reserved_balance_cents: number;
  total_earned_cents: number;
  total_withdrawn_cents: number;
  currency_code: string;
  is_frozen: boolean;
}

export function toWalletResponseDto(wallet: Wallet): WalletResponseDto {
  return {
    balance_cents: wallet.balanceCents,
    pending_balance_cents: wallet.pendingBalanceCents,
    reserved_balance_cents: wallet.reservedBalanceCents,
    total_earned_cents: wallet.totalEarnedCents,
    total_withdrawn_cents: wallet.totalWithdrawnCents,
    currency_code: wallet.currencyCode,
    is_frozen: wallet.isFrozen,
  };
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

export function toWalletTransactionResponseDto(tx: WalletTransaction): WalletTransactionResponseDto {
  return {
    id: tx.id,
    transaction_number: tx.transactionNumber,
    direction: tx.direction,
    transaction_type: tx.transactionType,
    amount_cents: tx.amountCents,
    balance_after_cents: tx.balanceAfterCents,
    description_ar: tx.descriptionAr,
    is_reversed: tx.isReversed,
    created_at: tx.createdAt.toISOString(),
  };
}

export interface PaymentResponseDto {
  id: string;
  payment_number: string;
  order_id: string | null;
  amount_cents: number;
  payment_method: string;
  payment_status: string;
  completed_at: string | null;
  /** null = دفعة الطلب الأصلية، غير null = محاولة تحصيل شغل إضافي (docs/08 §21). */
  order_item_batch_id: string | null;
  /** InstaPay بس — العميل قال إنه حوّل فعليًا (مش تأكيد نهائي، ده لسه بيتم من الأدمن). */
  customer_confirmed_transfer_at: string | null;
  failure_message: string | null;
}

export function toPaymentResponseDto(payment: Payment): PaymentResponseDto {
  return {
    id: payment.id,
    payment_number: payment.paymentNumber,
    order_id: payment.orderId,
    amount_cents: payment.amountCents,
    payment_method: payment.paymentMethod,
    payment_status: payment.paymentStatus,
    completed_at: payment.completedAt ? payment.completedAt.toISOString() : null,
    order_item_batch_id: payment.orderItemBatchId,
    customer_confirmed_transfer_at: payment.customerConfirmedTransferAt
      ? payment.customerConfirmedTransferAt.toISOString()
      : null,
    failure_message: payment.failureMessage,
  };
}

// §28 — طابور تأكيد InstaPay الإداري (كانت فجوة حقيقية: مفيش أي شاشة/endpoint بيجمّع الدفعات
// المعلّقة، الأدمن كان مضطر يدور عليها طلب-طلب من جوّه تفاصيل كل طلب لوحده). فيه اسم/رقم العميل
// (مش UUID خام — نفس درس §28.1) عشان الطابور يبقى قابل للاستخدام فعليًا من غير نداء تاني.
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

export interface SavedPaymentMethodResponseDto {
  id: string;
  provider: string;
  card_brand: string | null;
  masked_pan: string | null;
  is_default: boolean;
  created_at: string;
}

export function toSavedPaymentMethodResponseDto(method: SavedPaymentMethod): SavedPaymentMethodResponseDto {
  return {
    id: method.id,
    provider: method.provider,
    card_brand: method.cardBrand,
    masked_pan: method.maskedPan,
    is_default: method.isDefault,
    created_at: method.createdAt.toISOString(),
  };
}

export interface CardPaymentResponseDto {
  payment: PaymentResponseDto;
  redirect_url: string;
}

export interface FawryReferenceResponseDto {
  payment: PaymentResponseDto;
  reference_number: string;
  expires_at: string | null;
}

export interface InstaPayReferenceResponseDto {
  payment: PaymentResponseDto;
  reference_code: string;
  instructions_ar: string;
  /** صورة QR لاستقبال التحويل (docs/08 §78-د) — `null` لو الأدمن ما رفعش/ما ربطش واحدة. */
  qr_image_url: string | null;
}

export interface PayoutResponseDto {
  id: string;
  payout_number: string;
  amount_cents: number;
  net_amount_cents: number;
  payout_method: string;
  payout_status: string;
  requested_at: string;
  completed_at: string | null;
}

export function toPayoutResponseDto(payout: Payout): PayoutResponseDto {
  return {
    id: payout.id,
    payout_number: payout.payoutNumber,
    amount_cents: payout.amountCents,
    net_amount_cents: payout.netAmountCents,
    payout_method: payout.payoutMethod,
    payout_status: payout.payoutStatus,
    requested_at: payout.requestedAt.toISOString(),
    completed_at: payout.completedAt ? payout.completedAt.toISOString() : null,
  };
}

// مطابق لـ PayoutWithTechnician في payouts.service.ts — لقايمة الأدمن بس (GET /admin/payouts)،
// محتاجة تعرف مين الفني طالب الصرف عشان تكون قابلة للتصرف عليها فعلياً.
export interface AdminPayoutResponseDto extends PayoutResponseDto {
  technician_code: string;
  technician_name: string;
  technician_user_id: string;
  rejection_reason: string | null;
}

export function toAdminPayoutResponseDto(row: { payout: Payout; technicianCode: string; technicianName: string; technicianUserId: string }): AdminPayoutResponseDto {
  return {
    ...toPayoutResponseDto(row.payout),
    technician_code: row.technicianCode,
    technician_name: row.technicianName,
    technician_user_id: row.technicianUserId,
    rejection_reason: row.payout.rejectionReason,
  };
}

export interface PayoutOrderItemResponseDto {
  order_id: string;
  earning_cents: number;
  commission_cents: number;
}

export function toPayoutOrderItemResponseDto(item: PayoutOrderItem): PayoutOrderItemResponseDto {
  return {
    order_id: item.orderId,
    earning_cents: item.earningCents,
    commission_cents: item.commissionCents,
  };
}

export interface RefundResponseDto {
  id: string;
  refund_number: string;
  payment_id: string;
  order_id: string | null;
  /** رقم الطلب المقروء — من غيره القايمة أرقام استرداد بلا أي سياق يتصرّف عليه. */
  order_number: string | null;
  amount_cents: number;
  refund_type: string;
  refund_method: string;
  refund_status: string;
  reason_notes: string | null;
  requested_at: string;
  completed_at: string | null;
  provider_refund_id: string | null;
  /**
   * **الاسترداد ده النظام عمله لوحده** (إلغاء طلب مدفوع مقدّمًا قبل أي شغل) — مش قرار أدمن.
   *
   * طلب مالك صريح 2026-09-11: «لما الاسترداد بيتقبل تلقائيًا من النظام — وده المسار الصح —
   * لازم يبان للأدمن عشان يتابع». من غير العلم ده، صف النظام وصف الأدمن بيبانوا نفس الحاجة
   * في القايمة، والأدمن مش عارف أنهي واحد محتاج متابعة منه.
   */
  is_automatic: boolean;
  /**
   * محتاج تدخّل بشري دلوقتي: الاسترداد لسه `processing` يعني فلوس معلّقة في النص — البوابة
   * اتنادت وردها ما وصلش، والنظام **عمدًا** مابيخمّنش النتيجة (AUD-012). لازم موظف يثبّت
   * النتيجة من المزود عبر `POST /admin/refunds/:id/reconcile`.
   */
  needs_reconciliation: boolean;
  reconciled_at: string | null;
}

export function toRefundResponseDto(refund: Refund, orderNumber?: string | null): RefundResponseDto {
  return {
    id: refund.id,
    refund_number: refund.refundNumber,
    payment_id: refund.paymentId,
    order_id: refund.orderId,
    order_number: orderNumber ?? null,
    amount_cents: refund.amountCents,
    refund_type: refund.refundType,
    refund_method: refund.refundMethod,
    refund_status: refund.refundStatus,
    reason_notes: refund.reasonNotes,
    requested_at: refund.requestedAt.toISOString(),
    completed_at: refund.completedAt ? refund.completedAt.toISOString() : null,
    provider_refund_id: refund.providerRefundId,
    is_automatic: refund.requestedByUserId === PLATFORM_SYSTEM_USER_ID,
    needs_reconciliation:
      refund.refundStatus === RefundStatus.PROCESSING && refund.refundMethod === RefundMethod.ORIGINAL_METHOD,
    reconciled_at: refund.reconciledAt ? refund.reconciledAt.toISOString() : null,
  };
}

// Script 2 Part I (findings #46/#47) — راجع payment-provider.registry.ts's listAll() للسياق الكامل.
export interface PaymentChannelResponseDto {
  method: string;
  is_enabled: boolean;
  is_configured: boolean;
  is_available: boolean;
  /**
   * سبب عدم الإتاحة **بلغة العميل** (docs/08 §76-ز، بلاغ مالك صريح).
   *
   * كان بيرجع تشخيص تشغيلي حرفي للعميل: «بيانات تشغيل الطريقة غير مكتملة»، وأسوأ
   * «إعداد Paymob غير مكتمل: PAYMOB_HMAC_SECRET» — يعني أسماء متغيّرات إعداد الشركة كانت
   * بتوصل لشاشة عميل. ده مش بس شكل غير احترافي، ده تسريب معلومات عن البنية التحتية.
   * دلوقتي العميل بياخد جملة واحدة مفيدة ليه («مش متاحة دلوقتي، اختار طريقة تانية»)،
   * والتشخيص بيروح لـ`admin_note` اللي مبيتبعتش أصلاً إلا للأدمن.
   */
  unavailable_reason: string | null;
  /** تشخيص تشغيلي — **بيتبعت للأدمن بس**، بيبقى `undefined` تمامًا في رد العميل. */
  admin_note?: string;
}
