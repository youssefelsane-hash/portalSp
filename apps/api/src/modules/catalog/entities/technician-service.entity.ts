import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum SkillLevel {
  BEGINNER = 'beginner',
  STANDARD = 'standard',
  EXPERT = 'expert',
}

// مطابق لـ infra/migrations/0006_catalog.sql — الفنيين المؤهلين لكل خدمة (matching بيستخدمها فعلياً)
@Entity('technician_services')
export class TechnicianService {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'skill_level', type: 'enum', enum: SkillLevel, enumName: 'skill_level', default: SkillLevel.STANDARD })
  skillLevel: SkillLevel;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'completed_count', type: 'integer', default: 0 })
  completedCount: number;

  @Column({ name: 'average_rating', type: 'numeric', precision: 3, scale: 2, nullable: true })
  averageRating: string | null;

  @Column({ name: 'tested_at', type: 'timestamptz', nullable: true })
  testedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
