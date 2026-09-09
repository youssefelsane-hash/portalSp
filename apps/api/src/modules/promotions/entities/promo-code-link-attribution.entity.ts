import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/** أول رابط كود خصم وصل لمستخدم جديد؛ إسناد قياس فقط وليس قيدًا على استخدام الخصم. */
@Entity('promo_code_link_attributions')
export class PromoCodeLinkAttribution {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Index()
  @Column({ name: 'promo_code_id', type: 'uuid' })
  promoCodeId: string;

  @Column({ name: 'attributed_at', type: 'timestamptz', default: () => 'now()' })
  attributedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
