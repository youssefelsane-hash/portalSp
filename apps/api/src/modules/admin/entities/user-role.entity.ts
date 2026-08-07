import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// مفتاح مركّب (user_id, role_id) في القاعدة — TypeORM هنا بيتعامل معاه كـ composite primary key
@Entity('user_roles')
export class UserRole {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  assignedBy: string | null;

  @CreateDateColumn({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;
}
