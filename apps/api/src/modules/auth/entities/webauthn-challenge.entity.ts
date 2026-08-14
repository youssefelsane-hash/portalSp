import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export enum WebAuthnCeremonyType {
  REGISTRATION = 'registration',
  AUTHENTICATION = 'authentication',
  STEP_UP = 'step_up',
}

// تحديات WebAuthn المؤقتة (ADR-0011) — جدول منفصل عن otp_codes عمدًا (شكل مختلف تمامًا، مفيش
// ربط برقم موبايل). user_id ممكن يكون NULL وقت discoverable-credential login (السيرفر لسه
// ميعرفش مين المستخدم قبل التحقق من الرد).
@Entity('webauthn_challenges')
export class WebAuthnChallenge {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'ceremony_type', type: 'varchar', length: 20 })
  ceremonyType: WebAuthnCeremonyType;

  @Index()
  @Column({ type: 'text' })
  challenge: string;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
