import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BookingMode } from './order.entity';

export enum RecurringOrderFrequency {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

// مطابق لـ infra/migrations/0064_recurring_orders.sql — الجدولة المستقبلية/المتكررة (docs/08 §11)
@Entity('recurring_order_templates')
export class RecurringOrderTemplate {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @Column({ name: 'booking_mode', type: 'enum', enum: BookingMode, enumName: 'booking_mode', default: BookingMode.INDIVIDUAL })
  bookingMode: BookingMode;

  @Column({ name: 'requested_technician_id', type: 'uuid', nullable: true })
  requestedTechnicianId: string | null;

  @Column({ type: 'enum', enum: RecurringOrderFrequency, enumName: 'recurring_order_frequency' })
  frequency: RecurringOrderFrequency;

  @Column({ name: 'problem_description', type: 'text', nullable: true })
  problemDescription: string | null;

  // دفع قبل التوزيع (ADR-0013) لكل طلب متولّد من القالب — اختياري، NULL = دفع بعد الشغل زي
  // زمان (كاش/محفظة). نفس قيم CreateOrderDto.payment_method (docs/08 §19 بند 6).
  @Column({ name: 'payment_method', type: 'enum', enum: ['card', 'instapay'], enumName: 'payment_method', nullable: true })
  paymentMethod: 'card' | 'instapay' | null;

  @Column({ name: 'next_run_at', type: 'timestamptz' })
  nextRunAt: Date;

  @Column({ name: 'last_generated_order_id', type: 'uuid', nullable: true })
  lastGeneratedOrderId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
