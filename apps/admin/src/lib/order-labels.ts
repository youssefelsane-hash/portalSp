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

const CANCELLABLE_STATUSES: OrderStatus[] = [
  'draft',
  'pending_payment',
  'searching_technician',
  'technician_assigned',
  'accepted',
  'technician_on_way',
  'technician_arrived',
  'in_progress',
  'awaiting_quote_approval',
];

export function isOrderCancellable(status: OrderStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
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
