import type { SupportChannel, SupportTicketPriority, SupportTicketStatus } from '@baytak/shared-types';

export const TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  resolved: 'اتحلّت',
  closed: 'مقفولة',
};

export const TICKET_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  urgent: 'عاجلة',
};

export const TICKET_CHANNEL_LABELS: Record<SupportChannel, string> = {
  app: 'التطبيق',
  phone: 'تليفون',
  whatsapp: 'واتساب',
  email: 'إيميل',
};

export function ticketStatusBadgeVariant(status: SupportTicketStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'open':
      return 'destructive';
    case 'in_progress':
      return 'default';
    case 'resolved':
      return 'secondary';
    case 'closed':
      return 'outline';
  }
}

// مطابق بالحرف لـ ALLOWED_TRANSITIONS في apps/api/.../support-tickets.service.ts
export const TICKET_ALLOWED_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
};
