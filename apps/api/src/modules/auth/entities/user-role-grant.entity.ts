import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * الأدوار الاستهلاكية اللي الحساب يقدر يشتغل بيها (ADR-0110).
 *
 * النطاق **استهلاكي بس**. الموظفين (`admin`/`partner`) ممنوعين هنا بتريجر في القاعدة نفسها
 * (migration 0363) — مش بفحص في الكود، عشان مايتخطّاش بـrefactor.
 */
export enum AccountRole {
  CUSTOMER = 'customer',
  TECHNICIAN = 'technician',
}

// مطابق بالحرف لـ infra/migrations/0363_user_role_grants.sql
@Entity('user_role_grants')
export class UserRoleGrant {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  role: AccountRole;

  @Column({ name: 'granted_at', type: 'timestamptz', default: () => 'now()' })
  grantedAt: Date;

  /** NULL = منحة تلقائية من النظام. مش NULL = أدمن منحها بإيده. */
  @Column({ name: 'granted_by_user_id', type: 'uuid', nullable: true })
  grantedByUserId: string | null;

  @Column({ name: 'granted_reason', type: 'varchar', length: 40, nullable: true })
  grantedReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
