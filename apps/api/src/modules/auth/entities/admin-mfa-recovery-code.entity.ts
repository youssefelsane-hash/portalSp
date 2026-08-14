import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

// أكواد استرجاع لمرة واحدة (ADR-0011) — لازم تُستخدم مع OTP مش بمفردها، عشان الاسترجاع
// مايرجعش لعامل ضعيف واحد (SMS بمفرده). code_hash دايماً — نفس نمط otp_codes.code_hash.
@Entity('admin_mfa_recovery_codes')
export class AdminMfaRecoveryCode {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 255 })
  codeHash: string;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
