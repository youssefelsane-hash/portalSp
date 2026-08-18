export interface ThreadDto {
  id: string;
  order_id: string | null;
  thread_type: string;
  is_active: boolean;
  last_message_at: string | null;
  closes_at: string | null;
}

export interface MessageDto {
  id: string;
  thread_id: string;
  sender_user_id: string;
  message_type: string;
  content: string | null;
  file_url: string | null;
  is_flagged: boolean;
  created_at: string;
}

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export const getThreadForOrder = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<ThreadDto>(`/chat/orders/${orderId}/thread`);

export const listMessages = (authedFetch: AuthedFetch, threadId: string) =>
  authedFetch<MessageDto[]>(`/chat/threads/${threadId}/messages`);

export const sendMessage = (authedFetch: AuthedFetch, threadId: string, content: string) =>
  authedFetch<MessageDto>(`/chat/threads/${threadId}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
