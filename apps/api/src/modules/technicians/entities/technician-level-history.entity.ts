import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';
import { TechnicianLevel } from './technician-profile.entity';

export enum TechnicianLevelChangeType {
  PROMOTION = 'promotion',
  DEMOTION = 'demotion',
  MANUAL_OVERRIDE = 'manual_override',
}

// مطابق لـ infra/migrations/0005_customers_technicians.sql — جدول موجود من البداية بس مش
// مستخدم لحد دلوقتي (مفيش endpoint بيغيّر مستوى الفني). دلوقتي بيتفعّل عبر PATCH /admin/technicians/:id/level.
@Entity('technician_level_history')
export class TechnicianLevelHistory {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'previous_level', type: 'enum', enum: TechnicianLevel, enumName: 'technician_level', nullable: true })
  previousLevel: TechnicianLevel | null;

  @Column({ name: 'new_level', type: 'enum', enum: TechnicianLevel, enumName: 'technician_level' })
  newLevel: TechnicianLevel;

  @Column({ name: 'change_type', type: 'enum', enum: TechnicianLevelChangeType, enumName: 'technician_level_change_type' })
  changeType: TechnicianLevelChangeType;

  @Column({ name: 'quality_score_at_change', type: 'numeric', precision: 5, scale: 2 })
  qualityScoreAtChange: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId: string | null;

  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
