import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('complaint_messages')
export class ComplaintMessage {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'complaint_id', type: 'uuid' })
  complaintId: string;

  @Column({ name: 'sender_user_id', type: 'uuid' })
  senderUserId: string;

  @Column({ name: 'sender_role', type: 'varchar', length: 40 })
  senderRole: string;

  @Column({ type: 'text' })
  message: string;

  // ملاحظات داخلية للفريق — مش بتتبعت للعميل ولا للفني، بس فريق الدعم يشوفها
  @Column({ name: 'is_internal_note', type: 'boolean', default: false })
  isInternalNote: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
