import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0007_orders.sql — القائمة الكاملة في docs/02-data-dictionary.md §6.2
export enum OrderStatus {
  DRAFT = 'draft',
  PENDING_PAYMENT = 'pending_payment',
  SEARCHING_TECHNICIAN = 'searching_technician',
  TECHNICIAN_ASSIGNED = 'technician_assigned',
  ACCEPTED = 'accepted',
  TECHNICIAN_ON_WAY = 'technician_on_way',
  TECHNICIAN_ARRIVED = 'technician_arrived',
  IN_PROGRESS = 'in_progress',
  AWAITING_QUOTE_APPROVAL = 'awaiting_quote_approval',
  WORK_COMPLETED = 'work_completed',
  AWAITING_PAYMENT = 'awaiting_payment',
  COMPLETED = 'completed',
  CANCELLED_BY_CUSTOMER = 'cancelled_by_customer',
  CANCELLED_BY_TECHNICIAN = 'cancelled_by_technician',
  CANCELLED_BY_SYSTEM = 'cancelled_by_system',
  EXPIRED = 'expired',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
}

export enum OrderType {
  STANDARD = 'standard',
  EMERGENCY = 'emergency',
  SCHEDULED = 'scheduled',
  RECURRING = 'recurring',
  B2B = 'b2b',
}

export enum OrderPaymentStatus {
  UNPAID = 'unpaid',
  PENDING = 'pending',
  PAID = 'paid',
  PARTIALLY_REFUNDED = 'partially_refunded',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export enum OrderSourceChannel {
  CUSTOMER_APP = 'customer_app',
  WEB = 'web',
  CALL_CENTER = 'call_center',
  B2B_PORTAL = 'b2b_portal',
  WHATSAPP = 'whatsapp',
}

@Entity('orders')
export class Order {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_number', type: 'varchar', length: 24, unique: true })
  orderNumber: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  // تفضيل "إعادة الحجز" بس — مش ضمان، matching.service.ts بيحاول يعرضه عليه في أول جولة
  // بس بيكمّل بالتوزيع العادي لو مش متاح (تفاصيل في matching/README.md).
  @Column({ name: 'requested_technician_id', type: 'uuid', nullable: true })
  requestedTechnicianId: string | null;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @Column({ name: 'service_zone_id', type: 'uuid', nullable: true })
  serviceZoneId: string | null;

  @Column({ name: 'order_type', type: 'enum', enum: OrderType, enumName: 'order_type', default: OrderType.STANDARD })
  orderType: OrderType;

  @Column({ name: 'order_status', type: 'enum', enum: OrderStatus, enumName: 'order_status', default: OrderStatus.DRAFT })
  orderStatus: OrderStatus;

  @Column({ name: 'problem_description', type: 'text', nullable: true })
  problemDescription: string | null;

  @Column({ name: 'customer_notes', type: 'text', nullable: true })
  customerNotes: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'estimated_price_cents', type: 'integer', nullable: true })
  estimatedPriceCents: number | null;

  @Column({ name: 'inspection_fee_cents', type: 'integer', default: 0 })
  inspectionFeeCents: number;

  @Column({ name: 'surge_amount_cents', type: 'integer', default: 0 })
  surgeAmountCents: number;

  @Column({ name: 'discount_amount_cents', type: 'integer', default: 0 })
  discountAmountCents: number;

  @Column({ name: 'total_amount_cents', type: 'integer', default: 0 })
  totalAmountCents: number;

  @Column({ name: 'payment_method', type: 'enum', enum: ['cash', 'card', 'wallet', 'bank_transfer', 'corporate_credit'], enumName: 'payment_method', nullable: true })
  paymentMethod: string | null;

  @Column({ name: 'payment_status', type: 'enum', enum: OrderPaymentStatus, enumName: 'order_payment_status', default: OrderPaymentStatus.UNPAID })
  paymentStatus: OrderPaymentStatus;

  @Column({ name: 'promo_code_id', type: 'uuid', nullable: true })
  promoCodeId: string | null;

  @Column({ name: 'platform_commission_cents', type: 'integer', default: 0 })
  platformCommissionCents: number;

  @Column({ name: 'technician_earning_cents', type: 'integer', default: 0 })
  technicianEarningCents: number;

  @Column({ name: 'commission_rate_applied', type: 'numeric', precision: 5, scale: 2, nullable: true })
  commissionRateApplied: string | null;

  @Column({ name: 'placed_at', type: 'timestamptz', nullable: true })
  placedAt: Date | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'technician_departed_at', type: 'timestamptz', nullable: true })
  technicianDepartedAt: Date | null;

  @Column({ name: 'technician_arrived_at', type: 'timestamptz', nullable: true })
  technicianArrivedAt: Date | null;

  @Column({ name: 'work_started_at', type: 'timestamptz', nullable: true })
  workStartedAt: Date | null;

  @Column({ name: 'work_completed_at', type: 'timestamptz', nullable: true })
  workCompletedAt: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId: string | null;

  @Column({ name: 'cancellation_reason_id', type: 'uuid', nullable: true })
  cancellationReasonId: string | null;

  @Column({ name: 'cancellation_fee_cents', type: 'integer', default: 0 })
  cancellationFeeCents: number;

  @Column({ name: 'has_complaint', type: 'boolean', default: false })
  hasComplaint: boolean;

  @Column({ name: 'source_channel', type: 'enum', enum: OrderSourceChannel, enumName: 'order_source_channel', nullable: true })
  sourceChannel: OrderSourceChannel | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
