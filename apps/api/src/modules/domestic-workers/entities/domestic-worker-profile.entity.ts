import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { GeoJsonPoint } from '../../../common/types/geo-json';

export enum DomesticWorkerSpecialty {
  CLEANING_HOURLY = 'cleaning_hourly',
  BABYSITTING_HOURLY = 'babysitting_hourly',
  LIVE_IN_MAID_MONTHLY = 'live_in_maid_monthly',
}

export enum DomesticWorkerVerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

// مطابق لـ infra/migrations/0066_domestic_workers.sql — قطاع الخدمات المنزلية
// (docs/08 §12، ADR-0004) — كيان مستقل تمامًا عن technician_profiles.
@Entity('domestic_worker_profiles')
export class DomesticWorkerProfile {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'worker_code', type: 'varchar', length: 20 })
  workerCode: string;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ name: 'years_of_experience', type: 'smallint', default: 0 })
  yearsOfExperience: number;

  @Column({ type: 'enum', enum: DomesticWorkerSpecialty, enumName: 'domestic_worker_specialty', array: true, default: '{}' })
  specialties: DomesticWorkerSpecialty[];

  @Column({ name: 'hourly_rate_cents', type: 'integer', nullable: true })
  hourlyRateCents: number | null;

  @Column({ name: 'monthly_rate_cents', type: 'integer', nullable: true })
  monthlyRateCents: number | null;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: DomesticWorkerVerificationStatus,
    enumName: 'domestic_worker_verification_status',
    default: DomesticWorkerVerificationStatus.PENDING,
  })
  verificationStatus: DomesticWorkerVerificationStatus;

  @Column({ name: 'verification_notes', type: 'text', nullable: true })
  verificationNotes: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ name: 'is_available', type: 'boolean', default: true })
  isAvailable: boolean;

  @Column({
    name: 'current_location',
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  currentLocation: GeoJsonPoint | null;

  @Column({ name: 'average_rating', type: 'numeric', precision: 3, scale: 2, default: 0 })
  averageRating: string;

  @Column({ name: 'total_ratings_count', type: 'integer', default: 0 })
  totalRatingsCount: number;

  @Column({ name: 'completed_bookings_count', type: 'integer', default: 0 })
  completedBookingsCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
