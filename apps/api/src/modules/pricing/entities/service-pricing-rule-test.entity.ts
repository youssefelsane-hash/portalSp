import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// حالة اختبار محفوظة لمعادلة تسعير خدمة (Script 4 Part L §48) — "مدخل معيّن لازم ينتج سعر X"،
// بتتشغّل ضد القاعدة الحية أو معادلة مسوّدة (PricingEngineService.evaluateDraft) للتأكد إن أي
// تعديل مستقبلي ما كسرش سيناريو معروف.
@Entity('service_pricing_rule_tests')
export class ServicePricingRuleTest {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ type: 'varchar', length: 160 })
  label: string;

  @Column({ name: 'field_values', type: 'jsonb' })
  fieldValues: Record<string, string | number | boolean>;

  @Column({ name: 'expected_price_cents', type: 'integer' })
  expectedPriceCents: number;

  @Column({ name: 'created_by_admin_user_id', type: 'uuid', nullable: true })
  createdByAdminUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
