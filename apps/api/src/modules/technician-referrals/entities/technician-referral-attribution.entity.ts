import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0082_technician_qr_referral.sql
@Entity('technician_referral_attributions')
export class TechnicianReferralAttribution {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'customer_user_id', type: 'uuid', unique: true })
  customerUserId: string;

  @Column({ name: 'referral_token', type: 'varchar', length: 20 })
  referralToken: string;

  @Column({ name: 'attributed_at', type: 'timestamptz' })
  attributedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
