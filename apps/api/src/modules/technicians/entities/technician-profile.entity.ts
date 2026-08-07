import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { GeoJsonPoint } from '../../../common/types/geo-json';

export enum TechnicianLevel {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

export enum TechnicianVerificationStatus {
  PENDING = 'pending',
  DOCUMENTS_SUBMITTED = 'documents_submitted',
  UNDER_REVIEW = 'under_review',
  INTERVIEW_SCHEDULED = 'interview_scheduled',
  TEST_PASSED = 'test_passed',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

// مطابق لـ infra/migrations/0005_customers_technicians.sql
@Entity('technician_profiles')
export class TechnicianProfile {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'technician_code', type: 'varchar', length: 20, unique: true })
  technicianCode: string;

  @Column({ name: 'national_id_encrypted', type: 'text', select: false, nullable: true })
  nationalIdEncrypted: string | null;

  @Column({ name: 'years_of_experience', type: 'smallint', default: 0 })
  yearsOfExperience: number;

  @Column({
    name: 'current_level',
    type: 'enum',
    enum: TechnicianLevel,
    enumName: 'technician_level',
    default: TechnicianLevel.BRONZE,
  })
  currentLevel: TechnicianLevel;

  @Column({ name: 'quality_score', type: 'numeric', precision: 5, scale: 2, default: 0 })
  qualityScore: string;

  @Column({ name: 'average_rating', type: 'numeric', precision: 3, scale: 2, default: 0 })
  averageRating: string;

  @Column({ name: 'total_ratings_count', type: 'integer', default: 0 })
  totalRatingsCount: number;

  @Column({ name: 'completed_orders_count', type: 'integer', default: 0 })
  completedOrdersCount: number;

  @Column({ name: 'cancelled_orders_count', type: 'integer', default: 0 })
  cancelledOrdersCount: number;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: TechnicianVerificationStatus,
    enumName: 'technician_verification_status',
    default: TechnicianVerificationStatus.PENDING,
  })
  verificationStatus: TechnicianVerificationStatus;

  @Column({ name: 'is_available', type: 'boolean', default: false })
  isAvailable: boolean;

  @Column({ name: 'is_on_duty', type: 'boolean', default: false })
  isOnDuty: boolean;

  @Column({
    name: 'current_location',
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  currentLocation: GeoJsonPoint | null;

  @Column({ name: 'home_area_id', type: 'uuid', nullable: true })
  homeAreaId: string | null;

  @Column({ name: 'max_daily_orders', type: 'smallint', default: 8 })
  maxDailyOrders: number;

  @Column({ name: 'has_own_transport', type: 'boolean', default: false })
  hasOwnTransport: boolean;

  @Column({ name: 'has_own_tools', type: 'boolean', default: true })
  hasOwnTools: boolean;

  @Column({ name: 'emergency_available', type: 'boolean', default: false })
  emergencyAvailable: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
