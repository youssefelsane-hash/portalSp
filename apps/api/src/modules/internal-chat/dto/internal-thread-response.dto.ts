import { UserType } from '../../auth/entities/user.entity';
import { InternalChatThread } from '../entities/internal-chat-thread.entity';
import { InternalContact } from '../internal-chat.service';

export interface InternalThreadResponseDto {
  id: string;
  peer_user_id: string;
  peer_full_name: string;
  peer_user_type: UserType;
  last_message_at: string | null;
  created_at: string;
}

export function toInternalThreadResponseDto(row: {
  thread: InternalChatThread;
  peer: InternalContact;
}): InternalThreadResponseDto {
  return {
    id: row.thread.id,
    peer_user_id: row.peer.userId,
    peer_full_name: row.peer.fullName,
    peer_user_type: row.peer.userType,
    last_message_at: row.thread.lastMessageAt ? row.thread.lastMessageAt.toISOString() : null,
    created_at: row.thread.createdAt.toISOString(),
  };
}
