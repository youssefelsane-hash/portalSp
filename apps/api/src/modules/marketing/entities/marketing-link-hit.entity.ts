import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export const MARKETING_HIT_PLATFORMS = ['android', 'ios', 'web', 'other'] as const;
export type MarketingHitPlatform = (typeof MARKETING_HIT_PLATFORMS)[number];

/**
 * زيارة رابط اكتساب — **زيارة مش شخص** (ADR-0082 §4).
 *
 * مفيش IP ولا معرّف جهاز ولا كوكي هنا عن قصد: المالك طلبها بالحرف «مش الشخص ده تحذيرة، ولكن
 * كم واحد سكان». نتيجتها إن نفس الشخص لو فتح مرتين بيتعد ٢ — ودي حقيقة مكتوبة جنب الرقم في
 * اللوحة، مش تفصيلة مخفية.
 */
// مطابق لـ infra/migrations/0307_marketing_attribution.sql
@Entity('marketing_link_hits')
export class MarketingLinkHit {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Column({ type: 'varchar', length: 10 })
  platform: MarketingHitPlatform;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;
}
