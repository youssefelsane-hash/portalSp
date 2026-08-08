import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum SupportTicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum SupportTicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum SupportChannel {
  APP = 'app',
  PHONE = 'phone',
  WHATSAPP = 'whatsapp',
  EMAIL = 'email',
}

@Entity('support_tickets')
export class SupportTicket {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'ticket_number', type: 'varchar', length: 24, unique: true })
  ticketNumber: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 200 })
  subject: string;

  @Column({ type: 'varchar', length: 60 })
  category: string;

  @Column({ type: 'enum', enum: SupportTicketPriority, enumName: 'support_ticket_priority', default: SupportTicketPriority.MEDIUM })
  priority: SupportTicketPriority;

  @Column({ name: 'ticket_status', type: 'enum', enum: SupportTicketStatus, enumName: 'support_ticket_status', default: SupportTicketStatus.OPEN })
  ticketStatus: SupportTicketStatus;

  @Column({ type: 'enum', enum: SupportChannel, enumName: 'support_channel' })
  channel: SupportChannel;

  @Column({ name: 'assigned_to_user_id', type: 'uuid', nullable: true })
  assignedToUserId: string | null;

  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'satisfaction_rating', type: 'smallint', nullable: true })
  satisfactionRating: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
