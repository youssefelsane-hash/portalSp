import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export enum DevicePlatform {
  IOS = 'ios',
  ANDROID = 'android',
  WEB = 'web',
}

// مطابق لـ infra/migrations/0003_auth.sql — يتخزن مُشفّر (token_hash)، مع تدوير عند كل refresh
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 255, unique: true })
  tokenHash: string;

  @Column({ name: 'device_id', type: 'varchar', length: 128, nullable: true })
  deviceId: string | null;

  @Column({ name: 'device_name', type: 'varchar', length: 120, nullable: true })
  deviceName: string | null;

  @Column({ name: 'device_platform', type: 'enum', enum: DevicePlatform, enumName: 'device_platform', nullable: true })
  devicePlatform: DevicePlatform | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress: string | null;

  // آخر مرة اتستخدم فيها التوكن ده فعليًا (refresh) — لشاشة الأجهزة/الجلسات (ADR-0011 §5).
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  // إزاي المستخدم أثبت هويته وقت إصدار الجلسة دي (ADR-0011) — بينتقل لكل access token جديد وقت
  // refresh() بدل ما يضيع.
  @Column({ type: 'jsonb', default: () => `'["otp"]'` })
  amr: ('otp' | 'webauthn')[];

  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_reason', type: 'varchar', length: 80, nullable: true })
  revokedReason: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
