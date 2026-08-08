import type { PayoutMethod, PayoutStatus } from '@baytak/shared-types';

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

export function payoutStatusBadgeVariant(status: PayoutStatus) {
  if (status === 'completed' || status === 'approved') return 'secondary' as const;
  if (status === 'rejected' || status === 'failed') return 'destructive' as const;
  return 'outline' as const;
}
