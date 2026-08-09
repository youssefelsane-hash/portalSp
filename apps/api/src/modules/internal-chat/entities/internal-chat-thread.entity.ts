import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('internal_chat_threads')
export class InternalChatThread {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  // مرتّبين دايماً (a < b) — القيد ده مفروض على مستوى القاعدة نفسها (CHECK)، مش بس هنا.
  @Column({ name: 'participant_a_user_id', type: 'uuid' })
  participantAUserId: string;

  @Column({ name: 'participant_b_user_id', type: 'uuid' })
  participantBUserId: string;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
