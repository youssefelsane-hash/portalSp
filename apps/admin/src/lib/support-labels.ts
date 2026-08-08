import type { ComplaintCategory, ComplaintResolutionType, ComplaintSeverity, ComplaintStatus } from '@baytak/shared-types';

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  poor_quality: 'جودة سيئة',
  late_arrival: 'تأخير الوصول',
  no_show: 'الفني ملحقش',
  overcharging: 'سعر زيادة',
  rude_behavior: 'سوء تعامل',
  damage_to_property: 'ضرر بالممتلكات',
  incomplete_work: 'شغل ناقص',
  safety_concern: 'مخاوف أمان',
  fraud: 'احتيال',
  other: 'أخرى',
};

export const COMPLAINT_SEVERITY_LABELS: Record<ComplaintSeverity, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  open: 'مفتوحة',
  under_investigation: 'قيد التحقيق',
  awaiting_customer: 'مستنية رد العميل',
  awaiting_technician: 'مستنية رد الفني',
  resolved: 'اتحلّت',
  rejected: 'مرفوضة',
  escalated: 'مصعّدة',
  closed: 'مقفولة',
};

export const COMPLAINT_RESOLUTION_TYPE_LABELS: Record<ComplaintResolutionType, string> = {
  refund: 'استرجاع كامل',
  redo_service: 'إعادة تنفيذ الخدمة',
  partial_refund: 'استرجاع جزئي',
  warning_issued: 'إنذار للفني',
  technician_suspended: 'تعليق الفني',
  no_action: 'من غير إجراء',
};

// مطابق لـ OPEN_COMPLAINT_STATUSES في complaint-state-machine.ts — resolve/reject متاحين منها.
export const OPEN_COMPLAINT_STATUSES: ReadonlySet<ComplaintStatus> = new Set([
  'open',
  'under_investigation',
  'awaiting_customer',
  'awaiting_technician',
  'escalated',
]);

// مطابق للانتقال المسموح لـ CLOSED في complaint-state-machine.ts (بس من resolved/rejected).
export const CLOSABLE_COMPLAINT_STATUSES: ReadonlySet<ComplaintStatus> = new Set(['resolved', 'rejected']);

export function complaintStatusBadgeVariant(status: ComplaintStatus) {
  if (status === 'resolved' || status === 'closed') return 'secondary' as const;
  if (status === 'rejected') return 'outline' as const;
  if (status === 'escalated') return 'destructive' as const;
  return 'outline' as const;
}

export function complaintSeverityBadgeVariant(severity: ComplaintSeverity) {
  if (severity === 'critical' || severity === 'high') return 'destructive' as const;
  return 'outline' as const;
}
