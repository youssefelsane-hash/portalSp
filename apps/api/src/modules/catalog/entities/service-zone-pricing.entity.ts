import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum ZonePricingMode {
  OVERRIDE = 'override',
  PERCENTAGE = 'percentage',
}

@Entity('service_zone_pricing')
export class ServiceZonePricing {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'service_zone_id', type: 'uuid' })
  serviceZoneId: string;

  // docs/08 §36.22-23، ADR-0024 — override (رقم مطلق يستبدل السعر الأساسي بالكامل، السلوك
  // القديم) أو percentage (نسبة مئوية فوق service.base_price_cents، بتتحدّث تلقائيًا مع أي
  // تغيير في السعر الأساسي). بالظبط واحد من price_cents/modifier_percentage مطلوب حسب الوضع
  // (CHECK constraint في الداتابيز، migration 0161).
  @Column({ name: 'pricing_mode', type: 'enum', enum: ZonePricingMode, enumName: 'zone_pricing_mode', default: ZonePricingMode.OVERRIDE })
  pricingMode: ZonePricingMode;

  @Column({ name: 'price_cents', type: 'integer', nullable: true })
  priceCents: number | null;

  @Column({ name: 'modifier_percentage', type: 'numeric', precision: 6, scale: 2, nullable: true })
  modifierPercentage: string | null;

  @Column({ name: 'inspection_fee_cents', type: 'integer', default: 0 })
  inspectionFeeCents: number;

  @Column({ name: 'surge_multiplier', type: 'numeric', precision: 4, scale: 2, default: 1.0 })
  surgeMultiplier: string;

  // تاريخ سريان (docs/06 §3.10) — كانت أعمدة "خامدة" من أول يوم (migration 0006) من غير أي
  // mapping في الـ entity ولا استخدام في الكود، نفس فئة service_level_pricing/service_addons
  // (راجع catalog/README.md). أول استخدام حقيقي هنا: تسمح بأكتر من صف لنفس (خدمة، منطقة) بمدى
  // سريان مختلف (تخطيط مسبق لتغيير سعر مستقبلي)؛ estimate() بيختار الصف الساري فعليًا وقت
  // الطلب (validFrom <= الآن < validUntil أو validUntil=NULL). الطلبات القديمة مش متأثرة أصلاً
  // لأن السعر بيتخزن على الطلب نفسه وقت الإنشاء (orders.service.ts)، مش بيتحسب من هنا لاحقًا.
  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom: Date;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
