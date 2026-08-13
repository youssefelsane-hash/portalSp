import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { BookingMode } from './order.entity';

export enum CancellationRecoveryAction {
  AUTO_REMATCH = 'auto_rematch',
  MANUAL_RESELECTION_REQUIRED = 'manual_reselection_required',
}

// سجل مخصوص لكل إلغاء فني — منفصل عن order_status_history العام لأنه محتاج حقول قابلة
// للاستعلام (كود سبب/نص حر/وقت منقضي/هل جوّه النافذة المسموحة) مش موجودة هناك، مطابق لـ
// migration 0069. راجع orders/README.md § سياسة إلغاء الفني.
@Entity('technician_order_cancellations')
export class TechnicianOrderCancellation {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Index()
  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'technician_user_id', type: 'uuid' })
  technicianUserId: string;

  @Column({ name: 'cancellation_reason_id', type: 'uuid' })
  cancellationReasonId: string;

  @Column({ name: 'reason_text', type: 'text', nullable: true })
  reasonText: string | null;

  @Column({ name: 'booking_mode', type: 'enum', enum: BookingMode, enumName: 'booking_mode' })
  bookingMode: BookingMode;

  @Column({ name: 'accepted_at', type: 'timestamptz' })
  acceptedAt: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz' })
  cancelledAt: Date;

  @Column({ name: 'elapsed_seconds_after_acceptance', type: 'integer' })
  elapsedSecondsAfterAcceptance: number;

  @Column({ name: 'within_policy_window', type: 'boolean' })
  withinPolicyWindow: boolean;

  @Column({ name: 'recovery_action', type: 'varchar', length: 30 })
  recoveryAction: CancellationRecoveryAction;

  @Column({ name: 'fee_cents', type: 'integer', default: 0 })
  feeCents: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
