import { ChatMessage } from '../entities/chat-message.entity';

export interface MessageResponseDto {
  id: string;
  thread_id: string;
  sender_user_id: string;
  message_type: string;
  content: string | null;
  file_url: string | null;
  is_flagged: boolean;
  created_at: string;
}

export function toMessageResponseDto(message: ChatMessage): MessageResponseDto {
  return {
    id: message.id,
    thread_id: message.threadId,
    sender_user_id: message.senderUserId,
    message_type: message.messageType,
    content: message.content,
    file_url: message.fileUrl,
    is_flagged: message.isFlagged,
    created_at: message.createdAt.toISOString(),
  };
}
