import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق بالحرف لـ infra/migrations/0026_technician_companies.sql
@Entity('technician_companies')
export class TechnicianCompany {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid', unique: true })
  ownerUserId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ name: 'commercial_registration_number', type: 'varchar', length: 60, nullable: true })
  commercialRegistrationNumber: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
