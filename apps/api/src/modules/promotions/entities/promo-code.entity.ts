import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum DiscountType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
  FREE_INSPECTION = 'free_inspection',
}

// مطابق لـ infra/migrations/0010_promotions.sql
@Entity('promo_codes')
export class PromoCode {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 24, unique: true })
  code: string;

  @Column({ name: 'name_ar', type: 'varchar', length: 120 })
  nameAr: string;

  @Column({ name: 'discount_type', type: 'enum', enum: DiscountType, enumName: 'discount_type' })
  discountType: DiscountType;

  @Column({ name: 'discount_value', type: 'numeric', precision: 10, scale: 2 })
  discountValue: string;

  @Column({ name: 'max_discount_cents', type: 'integer', nullable: true })
  maxDiscountCents: number | null;

  @Column({ name: 'min_order_amount_cents', type: 'integer', default: 0 })
  minOrderAmountCents: number;

  @Column({ name: 'usage_limit_total', type: 'integer', nullable: true })
  usageLimitTotal: number | null;

  @Column({ name: 'usage_limit_per_user', type: 'smallint', default: 1 })
  usageLimitPerUser: number;

  @Column({ name: 'used_count', type: 'integer', default: 0 })
  usedCount: number;

  @Column({ name: 'applies_to_service_ids', type: 'uuid', array: true, nullable: true })
  appliesToServiceIds: string[] | null;

  @Column({ name: 'applies_to_zone_ids', type: 'uuid', array: true, nullable: true })
  appliesToZoneIds: string[] | null;

  @Column({ name: 'new_customers_only', type: 'boolean', default: false })
  newCustomersOnly: boolean;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom: Date;

  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil: Date;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  @Column({ name: 'budget_cents', type: 'integer', nullable: true })
  budgetCents: number | null;

  @Column({ name: 'spent_cents', type: 'integer', default: 0 })
  spentCents: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
