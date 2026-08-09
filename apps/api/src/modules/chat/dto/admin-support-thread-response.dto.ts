import { ChatThread } from '../entities/chat-thread.entity';

export interface AdminSupportThreadResponseDto {
  id: string;
  customer_name: string;
  customer_phone: string;
  is_active: boolean;
  last_message_at: string | null;
  created_at: string;
}

export function toAdminSupportThreadResponseDto(row: {
  thread: ChatThread;
  customerName: string;
  customerPhone: string;
}): AdminSupportThreadResponseDto {
  return {
    id: row.thread.id,
    customer_name: row.customerName,
    customer_phone: row.customerPhone,
    is_active: row.thread.isActive,
    last_message_at: row.thread.lastMessageAt ? row.thread.lastMessageAt.toISOString() : null,
    created_at: row.thread.createdAt.toISOString(),
  };
}
