import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  key: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: false })
  isEnabled: boolean;

  @Column({ name: 'rollout_percentage', type: 'smallint', default: 0 })
  rolloutPercentage: number;

  @Column({ name: 'enabled_for_user_ids', type: 'uuid', array: true, nullable: true })
  enabledForUserIds: string[] | null;

  @Column({ name: 'enabled_for_zone_ids', type: 'uuid', array: true, nullable: true })
  enabledForZoneIds: string[] | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
