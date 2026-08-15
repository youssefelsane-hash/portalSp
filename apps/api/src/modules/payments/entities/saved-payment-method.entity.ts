import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// طريقة دفع محفوظة (tokenized) — docs/08 §21. بيخزّن الـtoken اللي بترجّعه بوابة الدفع + بيانات
// آمنة للعرض بس (آخر 4 أرقام/نوع الكارت) — أبداً رقم كارت خام أو CVV، البوابة هي المسؤولة عن أي
// بيانات كارت حساسة. الاسم SavedPaymentMethod (مش PaymentMethod) عشان مايتعارضش مع enum
// PaymentMethod الموجود في payment.entity.ts (كاش/كارت/محفظة/إلخ).
@Entity('payment_methods')
export class SavedPaymentMethod {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  /** مفتاح provider من PaymentProviderRegistry (مثلاً 'paymob')، مش PaymentMethod enum. */
  @Column({ type: 'varchar', length: 40 })
  provider: string;

  @Column({ name: 'provider_token', type: 'varchar', length: 200 })
  providerToken: string;

  @Column({ name: 'card_brand', type: 'varchar', length: 20, nullable: true })
  cardBrand: string | null;

  @Column({ name: 'masked_pan', type: 'varchar', length: 20, nullable: true })
  maskedPan: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: true })
  isDefault: boolean;

  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
