import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { AccountRole } from './user-role-grant.entity';

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

  // heartbeat نشاط حقيقي (Script 5، migration 0136) — مختلف عن lastSeenAt فوق (بتتحدث بس وقت
  // تدوير access token كل ~15 دقيقة). تقريبية عبر كل جلسات المستخدم النشطة، مش جلسة بعينها —
  // تفاصيل القرار في docs/adr/0016-security-events-and-employee-activity.md.
  @Column({ name: 'last_activity_at', type: 'timestamptz', nullable: true })
  lastActivityAt: Date | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  // إزاي المستخدم أثبت هويته وقت إصدار الجلسة دي (ADR-0011) — بينتقل لكل access token جديد وقت
  // refresh() بدل ما يضيع.
  @Column({ type: 'jsonb', default: () => `'["otp"]'` })
  // `'pin'` اتضاف مع ADR-0109. العمود `jsonb` فمفيش migration مطلوبة — الصفوف القديمة
  // بقيمها زي ما هي، وأي كود بيقرا `amr` بيشوف طريقة الدخول الحقيقية للجلسة.
  amr: ('otp' | 'pin' | 'webauthn')[];

  /**
   * الدور النشط اللي الجلسة دي اتصدرت بيه (ADR-0110 §5). التدوير بيحافظ عليه **وبيعيد التحقق
   * من المنحة** — فسحب دور من الأدمن بيسقط الجلسة من أول تدوير، مش بعد ما التوكن ينتهي لوحده.
   * NULL = جلسة اتعملت قبل ADR-0110 أو جلسة موظف.
   */
  @Column({ name: 'active_role', type: 'varchar', length: 20, nullable: true })
  activeRole: AccountRole | null;

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
