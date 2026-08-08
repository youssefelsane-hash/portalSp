import { ChatThread } from '../entities/chat-thread.entity';

export interface ThreadResponseDto {
  id: string;
  order_id: string | null;
  thread_type: string;
  is_active: boolean;
  last_message_at: string | null;
  closes_at: string | null;
}

export function toThreadResponseDto(thread: ChatThread): ThreadResponseDto {
  return {
    id: thread.id,
    order_id: thread.orderId,
    thread_type: thread.threadType,
    is_active: thread.isActive,
    last_message_at: thread.lastMessageAt ? thread.lastMessageAt.toISOString() : null,
    closes_at: thread.closesAt ? thread.closesAt.toISOString() : null,
  };
}
