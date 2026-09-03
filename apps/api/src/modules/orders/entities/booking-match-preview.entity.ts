import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type BookingMatchSelectionMode = 'auto' | 'manual';
export type BookingMatchPreviewStatus = 'active' | 'consumed' | 'stale' | 'expired';

@Entity('booking_match_previews')
export class BookingMatchPreview {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  @Column({ name: 'technician_company_id', type: 'uuid', nullable: true })
  technicianCompanyId: string | null;

  @Column({ name: 'selection_mode', type: 'varchar', length: 10 })
  selectionMode: BookingMatchSelectionMode;

  @Column({ name: 'context_hash', type: 'varchar', length: 64 })
  contextHash: string;

  /** ADR-0065 §4 — نفس بصمة `orders.booking_context_hash` بالظبط (نفس الدالة بـtechnician_id فاضي). */
  @Column({ name: 'booking_context_hash', type: 'varchar', length: 64, nullable: true })
  bookingContextHash: string | null;

  /**
   * المدخلات اللي `context_hash` اتحسب منها (migration 0256) — عشان رفض التذكرة يقدر يقول
   * **إيه** الحقل اللي اتغيّر بدل «تفاصيل الحجز تغيّرت» المبهمة. حقول تسعير/مطابقة بس، بلا
   * أي بيانات شخصية.
   */
  @Column({ name: 'fingerprint_input', type: 'jsonb', nullable: true })
  fingerprintInput: Record<string, unknown> | null;

  @Column({ name: 'pricing_snapshot', type: 'jsonb' })
  pricingSnapshot: Record<string, unknown>;

  @Column({ name: 'final_price_cents', type: 'integer' })
  finalPriceCents: number;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: BookingMatchPreviewStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

