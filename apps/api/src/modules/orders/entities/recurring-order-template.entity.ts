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

  // "اعتماد" — تفضيل شركة/فريق محدد لكل طلب متولّد (نفس دلالة CreateOrderDto.requested_technician_company_id
  // بالحرف: تفضيل مش ضمان، ومسموح بس مع booking_mode=team). migration 0176.
  @Column({ name: 'requested_technician_company_id', type: 'uuid', nullable: true })
  requestedTechnicianCompanyId: string | null;

  // انتماء العمارة (migration 0257، docs/08 §122) — مختلف جوهريًا عن promo_code/addon_ids تحت:
  // العمارة مش خصم لمرة واحدة، هي انتماء دائم للعنوان. بنخزّن المعرّف بس، مش نسبة الخصم —
  // كل نوبة بتقرا الخصم الحالي وقت التوليد (نفس مسار الطلب العادي بالحرف)، فتغيير الإدارة
  // للنسبة بينعكس على النوبة الجديدة تلقائيًا من غير أي تدخل هنا.
  @Column({ name: 'building_id', type: 'uuid', nullable: true })
  buildingId: string | null;

  // مدخلات التسعير/التوقيت اللي بيتكرروا مع كل طلب متولّد (migration 0176) — القيم دي **مدخلات**
  // مش سعر: السعر بيتحدد من محرك التسعير الحي وقت توليد كل طلب (مفيش تجميد للسعر القديم)، بس
  // المدخلات نفسها هي اختيار العميل الأصلي اللي عايزه يتكرر. بدونهم، أي قالب لخدمة formula بحقول
  // إجبارية أو خدمة بتوقيت دقيق كان هيولّد طلبات بتفشل عند التحقق للأبد.
  // promo_code/addon_ids مش بتتخزن عمدًا — خصومات وإضافات لمرة واحدة مش بتتكرر. العمارة استثناء
  // مقصود (buildingId فوق) لأنها انتماء دائم مش خصم لمرة واحدة — راجع تعليقها.
  @Column({ name: 'field_values', type: 'jsonb', nullable: true })
  fieldValues: Record<string, string | number | boolean> | null;

  @Column({ name: 'pricing_quantity', type: 'numeric', precision: 10, scale: 2, nullable: true })
  pricingQuantity: string | null;

  @Column({ name: 'duration_hours', type: 'integer', nullable: true })
  durationHours: number | null;

  @Column({ name: 'duration_minutes', type: 'integer', nullable: true })
  durationMinutes: number | null;

  @Column({ name: 'scheduled_end_at', type: 'timestamptz', nullable: true })
  scheduledEndAt: Date | null;

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

  // تتبّع موثوقية التوليد (docs/08 §19 بند 20) — راجع RecurringOrdersService.generateFromTemplate()
  @Column({ name: 'consecutive_failure_count', type: 'integer', default: 0 })
  consecutiveFailureCount: number;

  @Column({ name: 'last_failure_reason', type: 'text', nullable: true })
  lastFailureReason: string | null;

  @Column({ name: 'last_failed_at', type: 'timestamptz', nullable: true })
  lastFailedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
