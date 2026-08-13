import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0078_customer_favorite_technicians.sql
@Entity('customer_favorite_technicians')
export class CustomerFavoriteTechnician {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'customer_user_id', type: 'uuid' })
  customerUserId: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
