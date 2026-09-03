import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum AssignmentStatus {
  SENT = 'sent',
  VIEWED = 'viewed',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
}

// منجم ذهب للتحليل — docs/02-data-dictionary.md §6.6 و §14.3
@Entity('order_assignments')
export class OrderAssignment {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'assignment_round', type: 'smallint' })
  assignmentRound: number;

  @Column({ name: 'distance_km', type: 'numeric', precision: 6, scale: 2, nullable: true })
  distanceKm: string | null;

  @Column({ name: 'estimated_eta_minutes', type: 'smallint', nullable: true })
  estimatedEtaMinutes: number | null;

  @Column({
    name: 'assignment_status',
    type: 'enum',
    enum: AssignmentStatus,
    enumName: 'order_assignment_status',
    default: AssignmentStatus.SENT,
  })
  assignmentStatus: AssignmentStatus;

  @Column({ name: 'rejection_reason_code', type: 'varchar', length: 40, nullable: true })
  rejectionReasonCode: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;

  /**
   * أول مشاهدة للعرض — بيتكتب مرة واحدة وماتتغيّرش بعدها (شرط `assignment_status = 'sent'` في
   * الـUPDATE بيضمن ده بنيويًا). NULL للصفوف اللي اتعملت قبل migration 0255، أو اللي ماتشافتش.
   */
  @Column({ name: 'viewed_at', type: 'timestamptz', nullable: true })
  viewedAt: Date | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
