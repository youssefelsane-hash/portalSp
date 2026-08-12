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

const CANCELLED_STATUSES: OrderStatus[] = [
  'cancelled_by_customer',
  'cancelled_by_technician',
  'cancelled_by_system',
  'expired',
];

export function orderStatusBadgeVariant(status: OrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'secondary';
  if (CANCELLED_STATUSES.includes(status) || status === 'disputed') return 'destructive';
  return 'outline';
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
