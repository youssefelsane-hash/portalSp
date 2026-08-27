import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { GeoJsonPoint } from '../../../common/types/geo-json';

// مطابق لـ infra/migrations/0027_technician_level_tiers.sql (rename من bronze/silver/gold/platinum
// + إضافة team_leader) — إعدادات كل مستوى (عمولة/أولوية/حد قرار) في technician_level_config.
export enum TechnicianLevel {
  NEW = 'new',
  VERIFIED = 'verified',
  PROFESSIONAL = 'professional',
  PREMIUM = 'premium',
  TEAM_LEADER = 'team_leader',
}

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — منفصلة تمامًا عن TechnicianLevel فوق. TechnicianLevel
// تشغيلي (حد قرار/أولوية مطابقة/أهلية قيادة فريق/تقدّم KPI)؛ pricing_tier مضاعف سعر تجاري بحت
// (service_pricing_tier_pricing) يقرره الأدمن بشكل مستقل تمامًا — صفر ربط تلقائي بينهم.
export enum TechnicianPricingTier {
  STANDARD = 'standard',
  EXPERT = 'expert',
  SENIOR = 'senior',
  PREMIUM = 'premium',
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

// فني مستقل، أو عضو جوّه شركة/فريق (infra/migrations/0026) — owner/manager عندهم سلطة
// إدارة الفريق، supervisor/worker أعضاء عاديين. منفصل تماماً عن roles/permissions الإدارية.
export enum TechnicianTeamRole {
  INDEPENDENT = 'independent',
  OWNER = 'owner',
  MANAGER = 'manager',
  SUPERVISOR = 'supervisor',
  WORKER = 'worker',
}

// "معاه مساعد؟" (docs/06 §3.7) — مسار طلب/موافقة، مش ربط مباشر (مطابق لـ infra/migrations/0055).
export enum TechnicianAssistantLinkStatus {
  NONE = 'none',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
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

  // ADR-0045 — الهوية الدائمة للفني. `select: false` مقصود: PII ما بيتحملش مع أي استعلام عادي،
  // اللي محتاجه بيطلبه صراحة (`addSelect`) وده بيخلي كل قراءة للرقم مقصودة وقابلة للتتبّع.
  @Column({ name: 'national_id_encrypted', type: 'text', select: false, nullable: true })
  nationalIdEncrypted: string | null;

  // الفهرس الأعمى — عليه UNIQUE جزئي (الحسابات غير المحذوفة بس). مش `select: false` لأنه
  // one-way ومش PII بذاته، والاستعلامات محتاجة تقارن بيه.
  @Column({ name: 'national_id_hash', type: 'char', length: 64, nullable: true })
  nationalIdHash: string | null;

  @Column({ name: 'national_id_set_at', type: 'timestamptz', nullable: true })
  nationalIdSetAt: Date | null;

  @Column({ name: 'national_id_set_by_user_id', type: 'uuid', nullable: true })
  nationalIdSetByUserId: string | null;

  @Column({ name: 'years_of_experience', type: 'smallint', default: 0 })
  yearsOfExperience: number;

  // موجود في الـ schema من أول يوم (migration 0005) بس مش متربط في الـ entity قبل كده —
  // أول استخدام حقيقي هو بروفايل الفني العام (راجع technicians/README.md).
  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({
    name: 'current_level',
    type: 'enum',
    enum: TechnicianLevel,
    enumName: 'technician_level',
    default: TechnicianLevel.NEW,
  })
  currentLevel: TechnicianLevel;

  @Column({
    name: 'pricing_tier',
    type: 'enum',
    enum: TechnicianPricingTier,
    enumName: 'technician_pricing_tier',
    default: TechnicianPricingTier.STANDARD,
  })
  pricingTier: TechnicianPricingTier;

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

  @Column({ name: 'verification_notes', type: 'text', nullable: true })
  verificationNotes: string | null;

  // ADR-0039 (docs/08 §62.1) — العلامة الزرقاء في واجهة العميل. **مش** مشتقة من verificationStatus:
  // دي أهلية تشغيلية (استوفى أوراقه ومسموح له يشتغل)، ودي قرار تجاري يدوي من الأدمن.
  @Column({ name: 'is_trust_verified', type: 'boolean', default: false })
  isTrustVerified: boolean;

  @Column({ name: 'trust_verified_at', type: 'timestamptz', nullable: true })
  trustVerifiedAt: Date | null;

  @Column({ name: 'trust_verified_by', type: 'uuid', nullable: true })
  trustVerifiedBy: string | null;

  @Column({ name: 'trust_verified_note', type: 'varchar', length: 500, nullable: true })
  trustVerifiedNote: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId: string | null;

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

  @Column({ name: 'current_location_updated_at', type: 'timestamptz', nullable: true })
  currentLocationUpdatedAt: Date | null;

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

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'team_role', type: 'varchar', length: 20, default: TechnicianTeamRole.INDEPENDENT })
  teamRole: TechnicianTeamRole;

  // "معاه مساعد؟" (docs/06 §3.7) — الفني بيطلب ربط مساعد بكود موظفه (technician_code)، الإدارة
  // توافق قبل ما يبقى رسمي. assistantTechnicianId بيفضل NULL لحد ما assistantLinkStatus=approved.
  @Column({ name: 'assistant_technician_id', type: 'uuid', nullable: true })
  assistantTechnicianId: string | null;

  @Column({
    name: 'assistant_link_status',
    type: 'enum',
    enum: TechnicianAssistantLinkStatus,
    enumName: 'technician_assistant_link_status',
    default: TechnicianAssistantLinkStatus.NONE,
  })
  assistantLinkStatus: TechnicianAssistantLinkStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
