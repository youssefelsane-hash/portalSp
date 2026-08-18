import type { OrderStatus } from '@baytak/shared-types';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'مسودة',
  pending_payment: 'بانتظار الدفع',
  searching_technician: 'جاري البحث عن فني',
  technician_assigned: 'اتعيّن فني',
  accepted: 'مقبول',
  technician_on_way: 'الفني في الطريق',
  technician_arrived: 'الفني وصل',
  in_progress: 'جاري التنفيذ',
  awaiting_quote_approval: 'بانتظار موافقة السعر',
  work_completed: 'الشغل خلص',
  awaiting_payment: 'بانتظار السداد',
  completed: 'مكتمل',
  cancelled_by_customer: 'ملغي من العميل',
  cancelled_by_technician: 'ملغي من الفني',
  cancelled_by_system: 'ملغي تلقائياً',
  expired: 'منتهي',
  disputed: 'متنازع عليه',
  refunded: 'مسترجَع',
  awaiting_technician_reselection: 'بانتظار اختيار فني بديل',
};

// إصلاح حقيقي (مراجعة booking flow الشاملة 2026-08-12) — كانت القايمة دي فيها 5 حالات زيادة
// (accepted/technician_on_way/technician_arrived/in_progress/awaiting_quote_approval) الأدمن
// كان يشوف زرار "إلغاء الطلب" ليها بس الباك-إند (admin-orders.service.ts's cancel()) بيرفضها
// دايمًا بـ409 — canTransition(status, CANCELLED_BY_SYSTEM) في order-state-machine.ts صحيح بس
// لـ draft/pending_payment/searching_technician/technician_assigned (رسالة الخطأ نفسها بتوضّح
// السبب: "بعد قبول الفني الإلغاء لازم يعدّي من الشكوى"). القايمة هنا بقت مطابقة حرفيًا.
const CANCELLABLE_STATUSES: OrderStatus[] = [
  'draft',
  'pending_payment',
  'searching_technician',
  'technician_assigned',
  // سياسة إلغاء الفني (docs/10) — order-state-machine.ts بيسمح admin cancel() يقفل الطلب من
  // الحالة دي (العميل واقف مستني اختيار فني بديل، ممكن يقرر يلغي كله بدل ما يستمر).
  'awaiting_technician_reselection',
];

export function isOrderCancellable(status: OrderStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

// مطابق حرفياً لـ REASSIGNABLE_STATUSES في apps/api/src/modules/orders/admin-orders.service.ts —
// التعيين اليدوي متاح بس قبل ما أي فني يقبل الطلب (searching_technician/technician_assigned).
// بعد accepted الباك-إند بيرفض (409) — الاستبدال بعد القبول لازم يعدّي من مسار الشكوى.
const REASSIGNABLE_STATUSES: OrderStatus[] = ['searching_technician', 'technician_assigned'];

export function isOrderReassignable(status: OrderStatus): boolean {
  return REASSIGNABLE_STATUSES.includes(status);
}

// مطابق حرفياً لـ RESCHEDULABLE_STATUSES في apps/api/src/modules/orders/orders.service.ts —
// إعادة الجدولة (عميل أو أدمن، Script 4 Part K §42) متاحة بس قبل ما الفني يتحرّك فعليًا.
const RESCHEDULABLE_STATUSES: OrderStatus[] = ['accepted', 'technician_assigned'];

export function isOrderReschedulable(status: OrderStatus): boolean {
  return RESCHEDULABLE_STATUSES.includes(status);
}

const CANCELLED_STATUSES: OrderStatus[] = [
  'cancelled_by_customer',
  'cancelled_by_technician',
  'cancelled_by_system',
  'expired',
];

// نظام التصميم المشترك (docs/12) — بديل أغنى دلاليًا من Badge العادي (اللي كان بيحصر كل الحالات
// النشطة/المعلّقة في تدرّج رمادي واحد "outline"، فمفيش فرق بصري بين "بانتظار الدفع" و"جاري التنفيذ"
// مثلاً رغم إنهم يستأهلوا انتباه مختلف تمامًا). الدالة القديمة `orderStatusBadgeVariant` اتشالت —
// كل الصفحات (orders/page.tsx, orders/[id]/page.tsx) بقت مستخدمة StatusChip.
export function orderStatusTone(status: OrderStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'completed') return 'success';
  if (CANCELLED_STATUSES.includes(status) || status === 'disputed') return 'danger';
  if (status === 'pending_payment' || status === 'awaiting_payment' || status === 'awaiting_quote_approval' || status === 'awaiting_technician_reselection') {
    return 'warning';
  }
  if (status === 'draft' || status === 'refunded') return 'neutral';
  // searching_technician/technician_assigned/accepted/technician_on_way/technician_arrived/
  // in_progress/work_completed — الطلب شغال طبيعي، لسه محتاج متابعة لكن مش تنبيه.
  return 'info';
}

// حالة الدفع (order_payment_status في infra/migrations/0002_enums.sql) — بَقّة حقيقية اتلقطت
// أثناء تطبيق StatusChip: صفحتي الطلبات (القايمة والتفاصيل) كانتا بتعرضوا `order.payment_status`
// خام (`unpaid`/`pending`/...) من غير ترجمة، تخالف نفس مبدأ "بدون enums خام" اللي اتصلح قبل كده
// في technician-kpi/[id].
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'لسه ما اتدفعش',
  pending: 'قيد التحصيل',
  paid: 'مدفوع',
  partially_refunded: 'مسترجَع جزئيًا',
  refunded: 'مسترجَع بالكامل',
  failed: 'فشل الدفع',
};

export function paymentStatusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'paid') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'failed') return 'danger';
  if (status === 'partially_refunded' || status === 'refunded') return 'neutral';
  return 'neutral';
}

// هيكل الحجز الجديد (docs/06 §1) — كانت فجوة موثّقة صراحة (P2 #32/#34): order_type/booking_mode
// موجودين في رد الباك-إند من زمان بس ما كانوش بيتعرضوا في apps/admin خالص، فمعلومات الطوارئ/
// الطلب المتكرر/إعادة الزيارة ماكانتش واضحة لفريق العمليات من غير فتح الداتابيز مباشرة.
export const ORDER_TYPE_LABELS: Record<string, string> = {
  standard: 'عادي',
  scheduled: 'مجدول',
  recurring: 'متكرر',
  b2b: 'B2B',
  emergency: 'طوارئ',
  revisit: 'إعادة زيارة',
};

export const BOOKING_MODE_LABELS: Record<string, string> = {
  individual: 'فرد',
  team: 'فريق',
  emergency: 'طوارئ',
};

export const RECURRING_FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'أسبوعيًا',
  monthly: 'شهريًا',
  yearly: 'سنويًا',
};
