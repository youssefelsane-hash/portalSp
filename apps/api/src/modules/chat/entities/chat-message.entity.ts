import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum ChatMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  LOCATION = 'location',
  SYSTEM = 'system',
  QUICK_REPLY = 'quick_reply',
}

// is_flagged ضروري — أكبر تسريب للفنيين خارج المنصة بيحصل من تبادل الأرقام في الشات (§14.6 في القاموس)
@Entity('chat_messages')
export class ChatMessage {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'thread_id', type: 'uuid' })
  threadId: string;

  @Column({ name: 'sender_user_id', type: 'uuid' })
  senderUserId: string;

  @Column({ name: 'message_type', type: 'enum', enum: ChatMessageType, enumName: 'chat_message_type' })
  messageType: ChatMessageType;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ name: 'file_url', type: 'text', nullable: true })
  fileUrl: string | null;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ name: 'is_flagged', type: 'boolean', default: false })
  isFlagged: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
