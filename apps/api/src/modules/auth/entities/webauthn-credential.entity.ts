import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مفاتيح Passkey العامة (ADR-0011) — public-key بس، السيرفر أبدًا ميخزّنش بيانات بيومترية خام.
@Entity('webauthn_credentials')
export class WebAuthnCredential {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'credential_id', type: 'text', unique: true })
  credentialId: string;

  @Column({ name: 'public_key', type: 'text' })
  publicKey: string;

  // منع replay — لازم يزيد كل استخدام، رفض واضح لو رجع أقل أو يساوي القيمة المخزّنة.
  @Column({ name: 'sign_count', type: 'bigint', default: 0, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  signCount: number;

  @Column({ name: 'device_label', type: 'varchar', length: 120, nullable: true })
  deviceLabel: string | null;

  @Column({ name: 'transports', type: 'jsonb', nullable: true })
  transports: AuthenticatorTransportFuture[] | null;

  @Column({ name: 'backed_up', type: 'boolean', default: false })
  backedUp: boolean;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
