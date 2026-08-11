import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum PricingRuleType {
  CONSTANT = 'constant',
  LOOKUP_TABLE = 'lookup_table',
  FORMULA = 'formula',
}

// صف واحد قاعدة تسعير — الشكل الفعلي لـ payload بيختلف حسب ruleType، راجع
// pricing-formula.types.ts للأنواع الكاملة وformula-evaluator.ts للـ evaluator الآمن.
@Entity('service_pricing_rules')
export class ServicePricingRule {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'rule_type', type: 'enum', enum: PricingRuleType, enumName: 'pricing_rule_type' })
  ruleType: PricingRuleType;

  @Column({ name: 'rule_key', type: 'varchar', length: 80 })
  ruleKey: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ name: 'display_order', type: 'smallint', default: 0 })
  displayOrder: number;

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

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
