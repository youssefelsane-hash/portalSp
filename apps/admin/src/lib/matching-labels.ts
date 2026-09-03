/**
 * نصوص وألوان حالات التوزيع — **نسخة واحدة** تستهلكها صفحة Operations وصفحة تفاصيل الطلب وصفحة
 * الفني. كانت متعرّفة جوّه صفحة Operations بس، فأول ما احتاجناها في صفحة تانية كان الاختيار إما
 * نسخة تانية تفترق مع أول تعديل، أو مكان مشترك — والمشروع اتعب قبل كده من النسخة التانية.
 */
export const DISPATCH_STATUS_LABELS_AR: Record<string, string> = {
  sent: 'مُرسل',
  viewed: 'تمت المشاهدة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  timeout: 'انتهت المهلة',
  cancelled: 'ملغي',
  offered: 'معروض',
  declined: 'مرفوض',
  closed: 'مُغلق',
};

export function dispatchStatusBadgeClass(status: string): string {
  if (['accepted'].includes(status)) return 'border-success/40 bg-success/10 text-success';
  if (['rejected', 'declined', 'timeout', 'cancelled'].includes(status)) return 'border-danger/40 bg-danger/10 text-danger';
  if (['viewed'].includes(status)) return 'border-warning/40 bg-warning/10 text-warning';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}
