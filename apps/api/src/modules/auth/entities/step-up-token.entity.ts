import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

// توكن تأكيد Passkey حديث للعمليات الحساسة (ADR-0011 §4) — معرّف صف حقيقي في Postgres، مش JWT
// ومش Redis key، عشان الاستهلاك-مرة-واحدة يكون fail-closed (فشل RedisCacheService بيترجم "miss
// آمن" = ثغرة إعادة استخدام حقيقية لضابط أمان، غير مقبول هنا). صالح دقيقتين بس.
@Entity('step_up_tokens')
export class StepUpToken {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
