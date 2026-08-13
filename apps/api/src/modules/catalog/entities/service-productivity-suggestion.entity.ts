import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// مرحلة 2 من محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — اقتراح تحديث
// productivity_per_day مبني على median لـobservations حقيقية (source='system_auto')، بانتظار
// موافقة/رفض الأدمن الصريحة. راجع ProductivityLearningService للـpipeline الكامل
// (observation → aggregate → suggestion → approve).
export enum ProductivitySuggestionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('service_productivity_suggestions')
export class ServiceProductivitySuggestion {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'service_standard_data_id', type: 'uuid' })
  serviceStandardDataId: string;

  @Column({ name: 'current_productivity_per_day', type: 'numeric', precision: 10, scale: 2 })
  currentProductivityPerDay: string;

  @Column({ name: 'suggested_productivity_per_day', type: 'numeric', precision: 10, scale: 2 })
  suggestedProductivityPerDay: string;

  @Column({ name: 'sample_size', type: 'integer' })
  sampleSize: number;

  @Column({ name: 'confidence_score', type: 'numeric', precision: 4, scale: 3 })
  confidenceScore: string;

  @Column({ type: 'varchar', length: 20, default: ProductivitySuggestionStatus.PENDING })
  status: ProductivitySuggestionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId: string | null;
}
