import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0003_auth.sql — الأدوار الخمسة الأساسية مزروعة من اليوم الأول
@Entity('roles')
export class Role {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  name: string;

  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  // باني الأدوار الديناميكي (ADR-0010) — دور معطّل بيوقف يمنح صلاحياته فورًا، عكسي (مختلف عن deletedAt).
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // يتخطى فحص role_permissions بالكامل — محدود على الدور المزروع، مش قابل للتعيين من أي API.
  @Column({ name: 'is_super_admin', type: 'boolean', default: false })
  isSuperAdmin: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
