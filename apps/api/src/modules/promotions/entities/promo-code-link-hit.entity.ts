import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export const PROMO_LINK_HIT_PLATFORMS = ['android', 'ios', 'web', 'other'] as const;
export type PromoLinkHitPlatform = (typeof PROMO_LINK_HIT_PLATFORMS)[number];

/** زيارة رابط QR/المشاركة. زيارة لا تعني شخصًا فريدًا عمدًا؛ لا نخزن IP أو جهاز. */
@Entity('promo_code_link_hits')
export class PromoCodeLinkHit {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'promo_code_id', type: 'uuid' })
  promoCodeId: string;

  @Column({ type: 'varchar', length: 10 })
  platform: PromoLinkHitPlatform;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;
}
