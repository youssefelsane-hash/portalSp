import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * إسناد مستخدم لمصدر تسويق — **أول لمسة، ودايم** (ADR-0082 §3).
 *
 * `UNIQUE(user_id)` على مستوى القاعدة هو اللي بيفرض القاعدة دي، مش شرط في الكود: تسجيلين
 * متزامنين بكودين مختلفين لازم واحد بس منهم ينجح، والتاني يتجاهل بهدوء.
 */
// مطابق لـ infra/migrations/0307_marketing_attribution.sql
@Entity('marketing_attributions')
export class MarketingAttribution {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Index()
  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Column({ name: 'attributed_at', type: 'timestamptz', default: () => 'now()' })
  attributedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
