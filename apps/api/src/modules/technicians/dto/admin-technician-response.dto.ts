import { StorageService } from '../../../common/storage/storage.service';
import { User } from '../../auth/entities/user.entity';
import { TechnicianProfile } from '../entities/technician-profile.entity';
import { TechnicianDocumentResponseDto, toTechnicianDocumentResponseDto } from './technician-document-response.dto';
import { TechnicianDocument } from '../entities/technician-document.entity';
import { CertificateResponseDto, toCertificateResponseDto } from './certificate-response.dto';
import { TechnicianCertificate } from '../entities/technician-certificate.entity';

export interface AdminTechnicianResponseDto {
  id: string;
  user_id: string;
  full_name: string;
  phone_number: string;
  technician_code: string;
  years_of_experience: number;
  current_level: string;
  pricing_tier: string;
  /** ADR-0050 — 'technician' أو 'assistant'. المساعد ما يظهرش في أي قايمة فنيين وما يقودش طلب. */
  technician_kind: string;
  quality_score: number;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  cancelled_orders_count: number;
  verification_status: string;
  // ADR-0039 — علامة التوثيق الزرقاء. مِنحة إدارية، **مش** مشتقة من verification_status فوق.
  is_trust_verified: boolean;
  trust_verified_at: string | null;
  trust_verified_note: string | null;
  is_available: boolean;
  is_on_duty: boolean;
  // بَقّة ثقة حقيقية اتلقطت (بلاغ المالك، 2026-08-21): is_available/is_on_duty فوق شكلهم بيوحي
  // إنهم بيمنعوا الفني من استقبال طلبات — مش صحيح، اتشالوا من الأهلية بالكامل من ADR-0017 (نموذج
  // Opt-out، الفني متاح افتراضيًا). الشرط الحقيقي الوحيد المتبقي اللي ممكن يمنع فني معتمد بمنطقة/
  // فئة سليمة من استقبال طلبات هو عدم وجود current_location خالص (لسه مفتحش تطبيق الفني بصلاحية
  // الموقع) — findEligibleTechnicians() (matching.service.ts) بيشترطه صراحة. الحقل ده بيعرضه
  // للأدمن عشان يبقى واضح إن ده السبب الفعلي، مش الفلاجين القديمين فوق.
  has_current_location: boolean;
  created_at: string;
  assistant_link_status: string;
  assistant_technician_id: string | null;
  online?: boolean;
  last_active_at?: string | null;
}

export function toAdminTechnicianResponseDto(profile: TechnicianProfile, user: User): AdminTechnicianResponseDto {
  return {
    id: profile.id,
    user_id: profile.userId,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    technician_code: profile.technicianCode,
    years_of_experience: profile.yearsOfExperience,
    current_level: profile.currentLevel,
    pricing_tier: profile.pricingTier,
    technician_kind: profile.technicianKind,
    quality_score: Number(profile.qualityScore),
    average_rating: Number(profile.averageRating),
    total_ratings_count: profile.totalRatingsCount,
    completed_orders_count: profile.completedOrdersCount,
    cancelled_orders_count: profile.cancelledOrdersCount,
    verification_status: profile.verificationStatus,
    is_trust_verified: profile.isTrustVerified,
    trust_verified_at: profile.trustVerifiedAt?.toISOString() ?? null,
    trust_verified_note: profile.trustVerifiedNote,
    is_available: profile.isAvailable,
    is_on_duty: profile.isOnDuty,
    has_current_location: profile.currentLocation !== null,
    created_at: profile.createdAt.toISOString(),
    assistant_link_status: profile.assistantLinkStatus,
    assistant_technician_id: profile.assistantTechnicianId,
  };
}

export interface AdminTechnicianDetailResponseDto extends AdminTechnicianResponseDto {
  documents: TechnicianDocumentResponseDto[];
  // الشهادات (docs/08) — كانت فجوة UI موثّقة صراحة: POST .../certificates/:certificateId/review
  // كان جاهز ومختبر بلا أي شاشة أدمن تعرض الشهادات pending أصلاً (الأدمن كان محتاج curl/Postman).
  certificates: CertificateResponseDto[];
  // تتبع أونلاين/آخر نشاط (docs/08 §35.10، ADR-0021 §6) — observability بحت، مفصولة تمامًا عن
  // is_available/is_on_duty فوق (نموذج قديم اتشال من الأهلية بالكامل، ADR-0017). `online` من
  // RealtimeSessionRegistry (اتصال socket لحظي)، `last_active_at` من آخر تجديد جلسة حقيقي
  // (MAX(refresh_tokens.last_seen_at)) — راجع TechnicianActivityService للتفاصيل الكاملة.
  online: boolean;
  last_active_at: string | null;
  // ADR-0045 — الهوية الدائمة. الرقم **مقنّع** هنا (آخر 4 أرقام بس)؛ الرقم كامل له endpoint
  // منفصل بصلاحية صريحة، فكل كشف كامل بيبقى فعل مقصود مش أثر جانبي لفتح الصفحة.
  national_id: {
    has_value: boolean;
    masked: string | null;
    set_at: string | null;
    // أكواد حسابات فنيين تانية بنفس الرقم القومي (بما فيها المتشالة) — إشارة "الشخص ده كان
    // عندنا قبل كده". فاضية في الحالة الطبيعية.
    linked_account_codes: string[];
  };
}

// docs/08 §19 بند 9 — الأدمن (بس مش الفني) هو الطرف الوحيد اللي بيقرا roots المستندات دي كتلة
// واحدة، فأصبحت async عشان توليد رابط طازة لكل مستند عن طريق getUrl(key) بدل file_url الثابت.
export async function toAdminTechnicianDetailResponseDto(
  profile: TechnicianProfile,
  user: User,
  documents: TechnicianDocument[],
  certificates: TechnicianCertificate[],
  storage: StorageService,
  activity: { online: boolean; lastActiveAt: Date | null },
  nationalId: { hasNationalId: boolean; maskedNationalId: string | null; setAt: Date | null; linkedAccountCodes: string[] },
): Promise<AdminTechnicianDetailResponseDto> {
  return {
    ...toAdminTechnicianResponseDto(profile, user),
    documents: await Promise.all(documents.map((d) => toTechnicianDocumentResponseDto(d, storage))),
    certificates: await Promise.all(certificates.map((c) => toCertificateResponseDto(c, storage))),
    online: activity.online,
    last_active_at: activity.lastActiveAt ? activity.lastActiveAt.toISOString() : null,
    national_id: {
      has_value: nationalId.hasNationalId,
      masked: nationalId.maskedNationalId,
      set_at: nationalId.setAt ? nationalId.setAt.toISOString() : null,
      linked_account_codes: nationalId.linkedAccountCodes,
    },
  };
}
