import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * **كود استرجاع رمز الدخول** (ADR-0109 §6-ب) — تصريح لمرة واحدة يخوّل صاحبه **يختار** رمز جديد.
 *
 * **مش رمز دخول**: مايفتحش جلسة، ومايرجّعش توكن، ومابيدّي أي وصول للحساب لوحده. الاستهلاك بيحصل
 * على صف حقيقي في Postgres (مش Redis) عشان يكون fail-closed — فشل الكاش بيترجم «miss آمن»، وده
 * على ضابط استهلاك-مرة-واحدة بيبقى ثغرة إعادة استخدام حقيقية.
 */
@Entity('pin_reset_tokens')
export class PinResetToken {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** هاش bcrypt — الكود الخام بيتعرض للأدمن مرة واحدة وقت الإصدار وعمره ما يتخزّن. */
  @Column({ name: 'code_hash', type: 'varchar', length: 255, select: false })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'failed_attempts', type: 'smallint', default: 0 })
  failedAttempts: number;

  /** مين من الدعم أصدره — الأثر الوحيد القابل للمراجعة على إجراء مابيثبتش هوية العميل تقنيًا. */
  @Column({ name: 'issued_by_user_id', type: 'uuid' })
  issuedByUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
