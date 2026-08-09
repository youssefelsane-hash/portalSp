export type ChatThreadType = 'order_chat' | 'support_chat';
export type ChatMessageType = 'text' | 'image';

export interface ThreadResponseDto {
  id: string;
  order_id: string | null;
  thread_type: ChatThreadType;
  is_active: boolean;
  last_message_at: string | null;
  closes_at: string | null;
}

export interface MessageResponseDto {
  id: string;
  thread_id: string;
  sender_user_id: string;
  message_type: ChatMessageType;
  content: string | null;
  file_url: string | null;
  is_flagged: boolean;
  created_at: string;
}

export interface AdminSupportThreadResponseDto {
  id: string;
  customer_name: string;
  customer_phone: string;
  is_active: boolean;
  last_message_at: string | null;
  created_at: string;
}
