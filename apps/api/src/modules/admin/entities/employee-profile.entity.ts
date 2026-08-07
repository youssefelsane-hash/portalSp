import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق بالحرف لـ infra/migrations/0024_employee_profiles.sql
// department هنا هيكل تنظيمي حر (org chart) — منفصل عمداً عن roles/permissions (صلاحيات وصول).
@Entity('employee_profiles')
export class EmployeeProfile {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'employee_code', type: 'varchar', length: 24, unique: true })
  employeeCode: string;

  @Index()
  @Column({ type: 'varchar', length: 60 })
  department: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Index()
  @Column({ name: 'manager_user_id', type: 'uuid', nullable: true })
  managerUserId: string | null;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hireDate: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
