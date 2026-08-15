import type { PaymentGatewayStatus, PaymentMethod, PayoutMethod, PayoutStatus, RefundMethod, RefundStatus } from '@baytak/shared-types';

export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  bank_transfer: 'تحويل بنكي',
  vodafone_cash: 'فودافون كاش',
  instapay: 'إنستاباي',
  cash: 'كاش',
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  requested: 'مطلوب',
  under_review: 'قيد المراجعة',
  approved: 'موافَق عليه',
  processing: 'جاري التنفيذ',
  completed: 'مكتمل',
  rejected: 'مرفوض',
  failed: 'فشل',
};

export function payoutStatusTone(status: PayoutStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'approved') return 'info';
  if (status === 'rejected' || status === 'failed') return 'danger';
  if (status === 'under_review' || status === 'processing') return 'warning';
  return 'neutral';
}

// الملخص المالي لكل طلب (docs/08 §20 بند 11) — GET /admin/orders/:id/financial-summary
export const PAYMENT_METHOD_LABELS_FULL: Record<PaymentMethod, string> = {
  cash: 'كاش',
  card: 'كارت',
  wallet: 'محفظة',
  bank_transfer: 'تحويل بنكي',
  corporate_credit: 'ائتمان شركات',
  fawry_reference: 'فوري',
  instapay: 'إنستاباي',
};

export const PAYMENT_GATEWAY_STATUS_LABELS: Record<PaymentGatewayStatus, string> = {
  pending: 'قيد الانتظار',
  processing: 'جاري التنفيذ',
  succeeded: 'ناجحة',
  failed: 'فشلت',
  cancelled: 'ملغاة',
  expired: 'منتهية',
  refunded: 'مسترجَعة بالكامل',
  partially_refunded: 'مسترجَعة جزئيًا',
};

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  original_method: 'وسيلة الدفع الأصلية',
  wallet_credit: 'رصيد محفظة',
  cash: 'كاش',
};

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  pending: 'قيد الانتظار',
  approved: 'موافَق عليه',
  processing: 'جاري التنفيذ',
  completed: 'مكتمل',
  rejected: 'مرفوض',
};
