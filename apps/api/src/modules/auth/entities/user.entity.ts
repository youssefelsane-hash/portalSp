import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// كل الجداول بتستخدم DEFAULT uuid_generate_v7() من قاعدة البيانات (infra/migrations/0001) —
// مش TypeORM. لما id متبقاش متحددة في الكائن، TypeORM بيسيبها لـ الـ DB default ويرجّعها بـ RETURNING.

// مطابق بالحرف لـ infra/migrations/0003_auth.sql و docs/02-data-dictionary.md §2.1
export enum UserType {
  CUSTOMER = 'customer',
  TECHNICIAN = 'technician',
  ADMIN = 'admin',
  PARTNER = 'partner',
}
// ملحوظة: قيمة enum قديمة 'domestic_worker' كانت هنا (ADR-0004) — اتشالت من TS بعد إلغاء نظام
// المزوّد المنفصل (ADR-0031). الشغالة/المربية بقت UserType.TECHNICIAN عادي زي أي فني تاني.
// قيمة الـPostgres enum type فضلت من غير تعديل عمدًا (orphaned بس غير مؤذية).

@Entity('users')
export class User {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Index()
  @Column({ name: 'phone_number', type: 'varchar', length: 15, unique: true })
  phoneNumber: string;

  @Column({ name: 'phone_verified_at', type: 'timestamptz', nullable: true })
  phoneVerifiedAt: Date | null;

  @Column({ type: 'varchar', length: 160, unique: true, nullable: true })
  email: string | null;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @Column({ name: 'full_name', type: 'varchar', length: 120 })
  fullName: string;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  // ADR-0031 — المصدر المعتمد (بعد موافقة الأدمن) لأفتار الفني/الشغالة، موجود لو فيه صورة معتمدة.
  // storage key ثابت مش رابط جاهز (presigned S3 URLs بتنتهي) — يتفك عبر resolveAvatarUrl() وقت
  // كل قراءة، نفس نمط branding/technician_documents/technician_certificates بالحرف.
  @Column({ name: 'avatar_storage_key', type: 'text', nullable: true })
  avatarStorageKey: string | null;

  @Index()
  @Column({ name: 'user_type', type: 'enum', enum: UserType, enumName: 'user_type' })
  userType: UserType;

  @Column({ name: 'preferred_language', type: 'varchar', length: 5, default: 'ar' })
  preferredLanguage: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'is_blocked', type: 'boolean', default: false })
  isBlocked: boolean;

  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
  blockedReason: string | null;

  @Column({ name: 'blocked_at', type: 'timestamptz', nullable: true })
  blockedAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'last_login_ip', type: 'inet', nullable: true })
  lastLoginIp: string | null;

  @Index()
  @Column({ name: 'referral_code', type: 'varchar', length: 12, unique: true, nullable: true })
  referralCode: string | null;

  @Column({ name: 'referred_by_user_id', type: 'uuid', nullable: true })
  referredByUserId: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
