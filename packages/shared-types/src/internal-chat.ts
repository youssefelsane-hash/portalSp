export interface InternalContactResponseDto {
  user_id: string;
  full_name: string;
  user_type: 'admin' | 'technician';
}

export interface InternalThreadResponseDto {
  id: string;
  peer_user_id: string;
  peer_full_name: string;
  peer_user_type: 'admin' | 'technician';
  last_message_at: string | null;
  created_at: string;
}

export interface InternalMessageResponseDto {
  id: string;
  thread_id: string;
  sender_user_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface StartInternalThreadBody {
  peer_user_id: string;
}
