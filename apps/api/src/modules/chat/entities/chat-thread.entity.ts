import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum ChatThreadType {
  ORDER_CHAT = 'order_chat',
  SUPPORT_CHAT = 'support_chat',
}

@Entity('chat_threads')
export class ChatThread {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true, nullable: true })
  orderId: string | null;

  @Column({ name: 'thread_type', type: 'enum', enum: ChatThreadType, enumName: 'chat_thread_type' })
  threadType: ChatThreadType;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @Column({ name: 'closes_at', type: 'timestamptz', nullable: true })
  closesAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
