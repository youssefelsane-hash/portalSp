import { InternalMessage } from '../entities/internal-message.entity';

export interface InternalMessageResponseDto {
  id: string;
  thread_id: string;
  sender_user_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export function toInternalMessageResponseDto(message: InternalMessage): InternalMessageResponseDto {
  return {
    id: message.id,
    thread_id: message.threadId,
    sender_user_id: message.senderUserId,
    content: message.content,
    is_read: message.isRead,
    created_at: message.createdAt.toISOString(),
  };
}
