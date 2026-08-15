import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0007_orders.sql (order_item_type ENUM في 0002_enums.sql) —
// docs/02-data-dictionary.md §6.4. 'service' غير مستخدم هنا عمداً — بند الخدمة الأساسي بيتحسب
// من orders.estimated_price_cents مباشرة، الجدول ده لبنود الفني الإضافية بس (قطع غيار/أجرة إضافية/إضافات).
export enum OrderItemType {
  SERVICE = 'service',
  ADDON = 'addon',
  SPARE_PART = 'spare_part',
  EXTRA_LABOR = 'extra_labor',
}

@Entity('order_items')
export class OrderItem {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'item_type', type: 'enum', enum: OrderItemType, enumName: 'order_item_type' })
  itemType: OrderItemType;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ name: 'name_ar', type: 'varchar', length: 160 })
  nameAr: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, default: 1 })
  quantity: string;

  @Column({ name: 'unit_name', type: 'varchar', length: 40, nullable: true })
  unitName: string | null;

  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents: number;

  @Column({ name: 'total_price_cents', type: 'integer' })
  totalPriceCents: number;

  @Column({ name: 'is_customer_approved', type: 'boolean', default: false })
  isCustomerApproved: boolean;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'added_by_user_id', type: 'uuid' })
  addedByUserId: string;

  @Column({ name: 'receipt_photo_url', type: 'text', nullable: true })
  receiptPhotoUrl: string | null;

  // بنود اقترحوا مع بعض في نفس نداء propose() بيشاركوا batch_id — عشان موافقة العميل تعامَل
  // كـ"طلب واحد" (docs/08 §21) — obligation دفع واحد، مش بند منفصل لكل عنصر.
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
