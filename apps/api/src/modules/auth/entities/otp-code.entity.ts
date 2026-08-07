import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export enum OtpPurpose {
  LOGIN = 'login',
  REGISTER = 'register',
  RESET_PASSWORD = 'reset_password',
  VERIFY_PHONE = 'verify_phone',
}

// مطابق لـ infra/migrations/0003_auth.sql — code_hash دايماً، ممنوع تخزين الكود صريح
@Entity('otp_codes')
export class OtpCode {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'phone_number', type: 'varchar', length: 15 })
  phoneNumber: string;

  @Column({ name: 'code_hash', type: 'varchar', length: 255 })
  codeHash: string;

  @Column({ type: 'enum', enum: OtpPurpose, enumName: 'otp_purpose' })
  purpose: OtpPurpose;

  @Column({ name: 'attempts_count', type: 'smallint', default: 0 })
  attemptsCount: number;

  @Column({ name: 'max_attempts', type: 'smallint', default: 5 })
  maxAttempts: number;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'request_ip', type: 'inet', nullable: true })
  requestIp: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
