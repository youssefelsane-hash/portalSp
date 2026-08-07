import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type SettingValueType = 'number' | 'boolean' | 'string' | 'json';

// مطابق لـ infra/migrations/0011_system.sql — إعدادات النظام بدون أي تعديل كود
@Entity('settings')
export class Setting {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ name: 'value_type', type: 'varchar', length: 20 })
  valueType: SettingValueType;

  @Column({ name: 'group_name', type: 'varchar', length: 40 })
  groupName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
