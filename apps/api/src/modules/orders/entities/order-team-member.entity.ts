import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0060_order_team_members.sql — توزيع أدوار الفريق داخل الطلب
// الواحد (docs/08 §5). إضافي فوق orders.technician_id ("قائد الطلب")، مش بديل له.
@Entity('order_team_members')
export class OrderTeamMember {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'role_label', type: 'varchar', length: 100 })
  roleLabel: string;

  @Column({ name: 'added_by_technician_id', type: 'uuid' })
  addedByTechnicianId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
