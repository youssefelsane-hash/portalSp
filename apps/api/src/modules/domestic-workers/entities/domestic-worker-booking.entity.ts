import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DomesticWorkerSpecialty } from './domestic-worker-profile.entity';

export enum DomesticWorkerBookingType {
  HOURLY = 'hourly',
  MONTHLY_LIVE_IN = 'monthly_live_in',
}

export enum DomesticWorkerBookingStatus {
  PENDING_CONFIRMATION = 'pending_confirmation',
  // الشغالة وافقت (بلا أي تحصيل — docs/adr/0019) لكن دفع InstaPay لسه معلّق تأكيده إداريًا.
  // مضافة في migration 0149.
  AWAITING_PAYMENT = 'awaiting_payment',
  CONFIRMED = 'confirmed',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

// مطابق لـ infra/migrations/0066_domestic_workers.sql — كيان مستقل تمامًا عن orders
// (القرار الكامل في docs/adr/0004-domestic-workers-vertical.md).
@Entity('domestic_worker_bookings')
export class DomesticWorkerBooking {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'booking_number', type: 'varchar', length: 24, unique: true })
  bookingNumber: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  workerId: string;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @Column({ type: 'enum', enum: DomesticWorkerSpecialty, enumName: 'domestic_worker_specialty' })
  specialty: DomesticWorkerSpecialty;

  @Column({ name: 'booking_type', type: 'enum', enum: DomesticWorkerBookingType, enumName: 'domestic_worker_booking_type' })
  bookingType: DomesticWorkerBookingType;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ name: 'duration_hours', type: 'smallint', nullable: true })
  durationHours: number | null;

  @Column({ name: 'auto_renew', type: 'boolean', default: false })
  autoRenew: boolean;

  @Column({ name: 'current_period_end_at', type: 'timestamptz', nullable: true })
  currentPeriodEndAt: Date | null;

  // الفترة المستهدفة وقت ما الحجز/التجديد awaiting_payment — بتتحول لـcurrentPeriodEndAt بس لما
  // InstaPay تتأكد إداريًا (شهري بس). مضافة في migration 0149 (docs/adr/0019).
  @Column({ name: 'pending_period_end_at', type: 'timestamptz', nullable: true })
  pendingPeriodEndAt: Date | null;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents: number;

  @Column({
    type: 'enum',
    enum: DomesticWorkerBookingStatus,
    enumName: 'domestic_worker_booking_status',
    default: DomesticWorkerBookingStatus.PENDING_CONFIRMATION,
  })
  status: DomesticWorkerBookingStatus;

  @Column({ name: 'customer_notes', type: 'text', nullable: true })
  customerNotes: string | null;

  // توقيت موافقة الشغالة الفعلي (status → AWAITING_PAYMENT). مضافة في migration 0149.
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  // معناها بقى "الدفع اتأكد إداريًا عبر InstaPay" (إعادة تعريف دلالي، docs/adr/0019) — مش "الشغالة
  // وافقت" زي قبل (ده بقى acceptedAt فوق). العمود نفسه موجود من migration 0066 الأصلية.
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
