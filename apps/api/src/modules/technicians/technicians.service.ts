import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { GeoService } from '../geo/geo.service';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Service } from '../catalog/entities/service.entity';
import { TechnicianService, TechnicianServiceVerificationStatus } from '../catalog/entities/technician-service.entity';
import {
  TechnicianAssistantLinkStatus,
  TechnicianLevel,
  TechnicianPricingTier,
  TechnicianProfile,
  TechnicianTeamRole,
} from './entities/technician-profile.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { SelfDeclareServiceDto } from './dto/self-declare-service.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { TechnicianPortfolioLink } from './entities/technician-portfolio-link.entity';
import { PortfolioLinksService } from './portfolio-links.service';
import { TechnicianCertificate } from './entities/technician-certificate.entity';
import { TechnicianCertificatesService } from './technician-certificates.service';
import { SettingsService } from '../settings/settings.service';
import {
  blockedExistsExpr,
  activeOrderConflictExistsExpr,
  describeTechnicianCapacity,
  technicianAvailabilityCondition,
  technicianScheduleConflictCondition,
  technicianIndividualVisibilityCondition,
  technicianServiceQualificationCondition,
} from './technician-eligibility.sql';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { CandidateOperationalLoad, dailyCapacityExceededExpr, resolveDailyCapacityMinutes } from './technician-day-capacity.sql';
import { cairoDayString, cairoDaySequence, cairoMidnight } from '../pricing/pricing-temporal';

/** مرحلة واحدة في تشخيص «ليه القايمة فاضية» — العدد المتبقّي بعد تطبيق شرطها تراكميًا. */
export interface BookingCandidatePoolStage {
  stage:
    | 'in_zone'
    | 'qualified'
    | 'has_location'
    | 'individually_visible'
    | 'team_level_ok'
    | 'not_blocked'
    | 'no_schedule_conflict'
    | 'available';
  labelAr: string;
  remaining: number;
}

export interface BookingCandidatePoolDiagnosis {
  zoneId: string;
  scheduledAt: Date | null;
  stages: BookingCandidatePoolStage[];
  /** أول مرحلة وصل فيها العدد لصفر — السبب الأساسي. `null` يعني فيه مرشّحين فعلاً. */
  firstBlockingStage: BookingCandidatePoolStage['stage'] | null;
}

export interface TechnicianBookingListItem {
  technicianId: string;
  fullName: string;
  avatarUrl: string | null;
  // ADR-0031 — لو موجود، ده المصدر الرسمي المعتمد (بيتفك لرابط طازة عبر storage.getUrl() في
  // catalog.controller.ts قبل الرد، مش avatarUrl الخام مباشرة — presigned URLs بتنتهي).
  avatarStorageKey: string | null;
  bio: string | null;
  averageRating: number;
  totalRatingsCount: number;
  serviceCompletedCount: number;
  distanceKm: number | null;
  // مضاعف سعر مستوى الفني (docs/08) — العميل لازم يشوف رتبة كل فني مرشّح قبل ما يختاره.
  currentLevel: TechnicianLevel;
  /** اسم المستوى المعروض زي ما الأدمن ضابطه (`technician_level_config.display_name_ar`). */
  currentLevelLabelAr: string | null;
  // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — مستقلة عن currentLevel، بتتبعت لـestimate()
  // عشان final_price_cents هنا يطابق تمامًا اللي هيتحسب فعليًا وقت الحجز الفعلي.
  pricingTier: TechnicianPricingTier;
  // العلامة الزرقاء في واجهة العميل (ADR-0039، docs/08 §62.1). **مِنحة إدارية يدوية** من
  // `technician_profiles.is_trust_verified` (أو `technician_companies` للشركات) — مش مشتقة من
  // `verification_status`. كانت `true` ثابتة هنا لكل صف، يعني أي حد يخلّص أوراقه ياخد العلامة.
  isVerified: boolean;
  onTimeRatePercent: number | null;
  /** عدد الزيارات اللي نسبة الالتزام اتحسبت منها — نسبة من زيارة واحدة مالهاش نفس المعنى. */
  onTimeSampleCount: number;
  /** متوسط التأخير بالدقايق على **الزيارات المتأخرة وحدها** (ADR-0099). */
  avgLateMinutes: number | null;
  /** متوسط مدة الانتقال **في نطاق الطلب** (بيرجع للمتوسط العام لو مفيش تاريخ في النطاق). */
  avgArrivalMinutes: number | null;
  /** إجمالي شغل الفني على المنصّة — مقابل `serviceCompletedCount` اللي للخدمة دي وحدها. */
  totalCompletedCount: number;
  // اندماج الشركات في نفس قايمة "اعتماد" (docs/08 §38) — false دايمًا لصفوف الفنيين الأفراد.
  // للشركات: technicianId = technician_companies.id، وcurrentLevel مالوش معنى حقيقي (بيتحط
  // TEAM_LEADER كتمثيل بس، مش مخزّن ولا بيتفحص).
  isCompany: boolean;
  /** ADR-0042 — معامل سعر الشركة (1 للأفراد). */
  companyPriceMultiplier?: number;
  staffCount: number | null;
  branchCount: number | null;
  companyId: string | null;
  companyName: string | null;
  isCommercialCompany: boolean;
  // سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030، docs/08 §42) — 'available' دايمًا لكل
  // الصفوف الحالية (رجريشن صفري). 'schedule_conflicted' بس لصفوف إضافية جديدة (Service.
  // showUnavailableProviders=true + scheduledAt موجودة) — مؤهّل فعلاً بس مشغول بشغل تاني وقت
  // الفترة المطلوبة، مش محظور/غير مؤهّل (الفئة دي تفضل مخفية تمامًا زي ما كانت دايمًا).
  availabilityStatus: 'available' | 'schedule_conflicted';
  unavailableReasonAr: string | null;
  availableAgainAt: string | null;
}

export function dedupeTechnicianBookingItems(
  items: TechnicianBookingListItem[],
): TechnicianBookingListItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.technicianId)) return false;
    seen.add(item.technicianId);
    return true;
  });
}

// تصنيف نوع الفني الأربعة (docs/06 §3.8) — دالة على بيانات موجودة بالفعل، مش مفهوم جديد.
// "فريق"/"شركة" (technician_companies, migration 0026) الفرق الوحيد بينهم commercial_registration_number
// (موجود=شركة، فاضي=فريق) — قرار سابق موثّق في technicians/README.md، مش اختراع جديد هنا.
export type TechnicianType = 'individual' | 'individual_with_assistant' | 'team' | 'company';

// النبذة تظهر علنًا للعميل، لذلك التحذير في التطبيق وحده لا يكفي: أي عميل API مباشر يجب أن
// يمر بنفس الحماية. نمنع وسائل التواصل الفعلية ونترك للفني مساحة يكتب خبرته وخدماته المهنية.
const TECHNICIAN_BIO_CONTACT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/i, label: 'بريدًا إلكترونيًا' },
  { pattern: /(?:https?:\/\/|www\.)\S+/i, label: 'رابطًا' },
  { pattern: /(?:\+?\d[\d\s().-]{7,}\d)/, label: 'رقم هاتف' },
  {
    pattern: /(?:instagram|facebook|tiktok|whatsapp|واتساب|واتس\s*اب|فيسبوك|انستجرام|تيك\s*توك)\s*[:@-]/i,
    label: 'وسيلة تواصل شخصية',
  },
];

function normalizeArabicDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(digit)]);
}

function validatePublicTechnicianBio(value: string): void {
  const normalized = normalizeArabicDigits(value);
  const violation = TECHNICIAN_BIO_CONTACT_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  if (violation) {
    throw new ApiException(
      ErrorCode.VAL_001,
      `النبذة لا يمكن أن تحتوي على ${violation.label}. اكتب خبرتك والخدمات التي تجيدها فقط.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

@Injectable()
export class TechniciansService {
  constructor(
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(TechnicianCompany) private readonly technicianCompanies: Repository<TechnicianCompany>,
    @InjectRepository(TechnicianService) private readonly technicianServices: Repository<TechnicianService>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly portfolioLinksService: PortfolioLinksService,
    private readonly certificatesService: TechnicianCertificatesService,
    private readonly auditLog: AuditLogService,
    private readonly geoService: GeoService,
    private readonly settingsService: SettingsService,
  ) {}

  async findByUserIdOrThrow(userId: string): Promise<TechnicianProfile> {
    const profile = await this.technicianProfiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ApiException(ErrorCode.TECH_001, 'حسابك غير معتمد بعد', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  // بَقّة حقيقية اتلقطت واتصلحت: TypeORM بيسقط أي خاصية قيمتها JS null من findOne({where})
  // بدل ما يولّد "id IS NULL" — يعني findOne({where:{id: null}}) كان بيرجّع صف عشوائي (أول
  // صف بترتيب فحص الفهرس، مش الأقدم إنشاءً) بدل ما يرجع فاضي. الفحص الصريح ده بيمنع أي استدعاء
  // بقيمة null/undefined (حتى لو TypeScript مقتنع إنها string بسبب `!` غير موثوق) من يوصل
  // للـ query أصلاً. اتلقطت وقت اختبار حي لدفع طلب اتعمله بـ raw SQL بتقنية "أعمى" (technician_id
  // فاضي) — العمولة اترحّلت فعلياً لمحفظة فني عشوائي غير مرتبط بالطلب. راجع payments/README.md.
  async findByProfileIdOrThrow(profileId: string | null | undefined): Promise<TechnicianProfile> {
    if (!profileId) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    const profile = await this.technicianProfiles.findOne({ where: { id: profileId } });
    if (!profile) {
      throw new ApiException(ErrorCode.VAL_001, 'بروفايل الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    return profile;
  }

  // اسم/تليفون الفني للعرض للعميل بعد تأكيد حجيز حقيقي (docs/08 §22 بند 1) — الكولر (orders.controller.ts)
  // هو المسؤول عن فحص شرط الظهور (CUSTOMER_TECHNICIAN_CONTACT_VISIBLE_STATUSES) قبل ما ينادي الدالة دي أصلاً.
  async findContactInfoOrThrow(profileId: string): Promise<{ name: string; phone: string }> {
    const profile = await this.findByProfileIdOrThrow(profileId);
    const user = await this.users.findOne({ where: { id: profile.userId } });
    if (!user) {
      throw new ApiException(ErrorCode.VAL_001, 'مستخدم الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    return { name: user.fullName, phone: user.phoneNumber };
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto): Promise<TechnicianProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (dto.is_available !== undefined) profile.isAvailable = dto.is_available;
    if (dto.is_on_duty !== undefined) profile.isOnDuty = dto.is_on_duty;
    await this.technicianProfiles.save(profile);
    return profile;
  }

  async updateProfile(userId: string, dto: UpdateTechnicianProfileDto): Promise<TechnicianProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (dto.bio !== undefined) {
      const bio = dto.bio.trim();
      if (bio) validatePublicTechnicianBio(bio);
      profile.bio = bio || null;
    }
    await this.technicianProfiles.save(profile);
    return profile;
  }

  // ── تصريح مهارات ذاتي (Script 4 §2-7) ──────────────────────────────
  // الفني ≠ مجرد technician=true — لازم نعرف بالظبط إيه الشغل المسموح له يستلمه. الفني بيختار
  // خدمة من الكتالوج الديناميكي الموجود بالفعل، بس التصريح لوحده مايديهوش أهلية مطابقة فورية —
  // بيدخل طابور مراجعة أدمن (pending_verification) لحد ما يتاعتمد. matching.service.ts وباقي
  // مواقع أهلية المطابقة بتتحقق من verification_status='approved' صراحةً (راجع matching/README.md).

  async listMyServices(userId: string): Promise<TechnicianService[]> {
    const profile = await this.findByUserIdOrThrow(userId);
    return this.technicianServices.find({ where: { technicianId: profile.id }, order: { createdAt: 'DESC' } });
  }

  async declareService(userId: string, dto: SelfDeclareServiceDto): Promise<TechnicianService> {
    const profile = await this.findByUserIdOrThrow(userId);
    const service = await this.services.findOne({ where: { id: dto.service_id } });
    if (!service || !service.isActive) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة غير موجودة أو متوقفة', HttpStatus.NOT_FOUND);
    }

    const existing = await this.technicianServices.findOne({
      where: { technicianId: profile.id, serviceId: dto.service_id },
    });
    if (existing) {
      // رفض قديم — الفني يقدر يعيد التصريح (نفس الصف، مش تكرار). أي حالة تانية (معتمد/تحت
      // المراجعة/موقوف) قرار قائم بالفعل، مينفعش يتصرّح بيه تاني.
      if (existing.verificationStatus !== TechnicianServiceVerificationStatus.REJECTED) {
        throw new ApiException(ErrorCode.VAL_001, 'عندك طلب/اعتماد قائم بالفعل لنفس الخدمة دي', HttpStatus.CONFLICT);
      }
      const previousStatus = existing.verificationStatus;
      existing.wageTier = dto.skill_level ?? existing.wageTier;
      existing.verificationStatus = TechnicianServiceVerificationStatus.PENDING_VERIFICATION;
      existing.isSelfDeclared = true;
      existing.isActive = false;
      existing.rejectionReason = null;
      existing.reviewedByUserId = null;
      existing.reviewedAt = null;
      await this.technicianServices.save(existing);

      await this.auditLog.record({
        actorUserId: userId,
        actorRole: 'technician',
        action: 'technician_service.re_declared',
        entityType: 'technician_service',
        entityId: existing.id,
        oldValues: { verification_status: previousStatus },
        newValues: { verification_status: existing.verificationStatus, service_id: dto.service_id },
      });
      return existing;
    }

    const row = this.technicianServices.create({
      technicianId: profile.id,
      serviceId: dto.service_id,
      wageTier: dto.skill_level,
      isActive: false,
      isSelfDeclared: true,
      verificationStatus: TechnicianServiceVerificationStatus.PENDING_VERIFICATION,
    });
    await this.technicianServices.save(row);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_service.declared',
      entityType: 'technician_service',
      entityId: row.id,
      newValues: { service_id: dto.service_id, wage_tier: row.wageTier },
    });
    return row;
  }

  private async findMyServiceOrThrow(userId: string, technicianServiceId: string): Promise<TechnicianService> {
    const profile = await this.findByUserIdOrThrow(userId);
    const row = await this.technicianServices.findOne({ where: { id: technicianServiceId } });
    if (!row || row.technicianId !== profile.id) {
      throw new ApiException(ErrorCode.VAL_001, 'التصريح غير موجود', HttpStatus.NOT_FOUND);
    }
    return row;
  }

  // سحب تصريح (Script 4 §7 — "إزالة/إيقاف مهارة لازم يأثّر على المطابقة المستقبلية بس ما يبطلش
  // طلبات نشطة بالفعل"). طلب لسه تحت المراجعة أو مرفوض: حذف فعلي (مفيش تاريخ قيّم يستاهل يتحفظ).
  // خدمة معتمدة بالفعل: تعطيل بس (is_active=false)، مش حذف — نفس فلسفة is_active الموجودة من زمان،
  // وسجل الاعتماد التاريخي يفضل موجود للتدقيق.
  async withdrawService(userId: string, technicianServiceId: string): Promise<void> {
    const row = await this.findMyServiceOrThrow(userId, technicianServiceId);
    if (row.verificationStatus === TechnicianServiceVerificationStatus.SUSPENDED) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة دي موقوفة من الإدارة — تواصل مع الدعم', HttpStatus.FORBIDDEN);
    }

    if (row.verificationStatus === TechnicianServiceVerificationStatus.APPROVED) {
      row.isActive = false;
      await this.technicianServices.save(row);
    } else {
      await this.technicianServices.delete({ id: row.id });
    }

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician_service.withdrawn',
      entityType: 'technician_service',
      entityId: row.id,
      oldValues: { verification_status: row.verificationStatus },
    });
  }

  // ── "معاه مساعد؟" (docs/06 §3.7) ────────────────────────────────────

  /** الفني بيطلب ربط مساعد بكود موظفه (technician_code) — يفضل pending_approval لحد ما الإدارة توافق. */
  async requestAssistant(userId: string, assistantTechnicianCode: string): Promise<TechnicianProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (profile.assistantLinkStatus !== TechnicianAssistantLinkStatus.NONE) {
      throw new ApiException(ErrorCode.VAL_001, 'عندك طلب مساعد قائم بالفعل — شيله الأول لو عايز تطلب واحد جديد', HttpStatus.CONFLICT);
    }

    const assistant = await this.technicianProfiles.findOne({ where: { technicianCode: assistantTechnicianCode } });
    if (!assistant) {
      throw new ApiException(ErrorCode.VAL_001, 'كود الفني غير موجود', HttpStatus.NOT_FOUND);
    }
    if (assistant.id === profile.id) {
      throw new ApiException(ErrorCode.VAL_001, 'مينفعش تطلب نفسك كمساعد', HttpStatus.BAD_REQUEST);
    }

    profile.assistantTechnicianId = assistant.id;
    profile.assistantLinkStatus = TechnicianAssistantLinkStatus.PENDING_APPROVAL;
    await this.technicianProfiles.save(profile);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician.assistant_requested',
      entityType: 'technician_profile',
      entityId: profile.id,
      newValues: { assistant_technician_id: assistant.id, assistant_technician_code: assistantTechnicianCode },
    });
    return profile;
  }

  /** إزالة ذاتية — مفيش داعي موافقة إدارة لفك الربط، بس تكوينه من الأول محتاج موافقة. */
  async removeAssistant(userId: string): Promise<TechnicianProfile> {
    const profile = await this.findByUserIdOrThrow(userId);
    if (profile.assistantLinkStatus === TechnicianAssistantLinkStatus.NONE) {
      throw new ApiException(ErrorCode.VAL_001, 'مفيش مساعد مرتبط أصلاً', HttpStatus.NOT_FOUND);
    }

    const oldAssistantId = profile.assistantTechnicianId;
    profile.assistantTechnicianId = null;
    profile.assistantLinkStatus = TechnicianAssistantLinkStatus.NONE;
    await this.technicianProfiles.save(profile);

    await this.auditLog.record({
      actorUserId: userId,
      actorRole: 'technician',
      action: 'technician.assistant_removed',
      entityType: 'technician_profile',
      entityId: profile.id,
      oldValues: { assistant_technician_id: oldAssistantId },
    });
    return profile;
  }

  // تصنيف نوع الفني الأربعة (docs/06 §3.8) — دالة على بيانات موجودة، مش حالة مخزّنة بشكل منفصل
  // (تفادي احتمال عدم اتساق بين عمود مخزّن والبيانات الحقيقية).
  async classifyType(profile: TechnicianProfile): Promise<TechnicianType> {
    if (profile.teamRole !== TechnicianTeamRole.INDEPENDENT && profile.companyId) {
      const company = await this.technicianCompanies.findOne({ where: { id: profile.companyId } });
      if (company?.commercialRegistrationNumber) return 'company';
      return 'team';
    }
    if (profile.assistantLinkStatus === TechnicianAssistantLinkStatus.APPROVED) {
      return 'individual_with_assistant';
    }
    return 'individual';
  }

  /**
   * منطقة الخدمة اللي عنوان العميل واقع فيها — **نقطة القراءة الوحيدة** للسؤال ده.
   *
   * كانت مدفونة جوّه `listForServiceBooking()`، فالكولر ماكانش يعرف المنطقة إلا **بعد** ما
   * القايمة ترجع. ده خلّى استحالة يحسب سعر/حمل تشغيلي بالمنطقة الصح **قبل** فلترة التوافر
   * (ADR-0064 §3). استخراج، مش نسخة تانية — `listForServiceBooking()` نفسها بقت بتناديها.
   */
  async resolveZoneForAddressOrThrow(addressId: string): Promise<ServiceZone> {
    interface AddressRow {
      city_id: string | null;
      latitude: number;
      longitude: number;
    }
    const [address] = await this.technicianProfiles.manager.query<AddressRow[]>(
      `SELECT city_id, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
       FROM addresses WHERE id = $1 AND deleted_at IS NULL`,
      [addressId],
    );
    if (!address || !address.city_id) {
      throw new ApiException(ErrorCode.VAL_001, 'العنوان غير موجود', HttpStatus.NOT_FOUND);
    }
    const zone = await this.geoService.findZoneForPoint(address.city_id, address.latitude, address.longitude);
    if (!zone) {
      throw new ApiException(ErrorCode.VAL_001, 'الخدمة مش متاحة في منطقتك دلوقتي', HttpStatus.CONFLICT);
    }
    return zone;
  }

  /**
   * قايمة الفنيين المؤهلين لخدمة في منطقة العميل — اختيار الفني قبل الحجز (docs/08 §3، بدل
   * auto-match بس). مرحلتين (Script 6 Part 9):
   *
   * **المرحلة 1 — أهلية صارمة (hard gate)**: WHERE clause تحت — verification_status='approved'،
   * عنده صف technician_services نشط للخدمة دي بالذات، عنده صف technician_zones نشط للمنطقة دي.
   * أي فني ماعندوش الثلاثة دول **مش بيظهر خالص**، مهما كان تقييمه.
   *
   * **المرحلة 2 — ترتيب التوصية (recommendation score)**: بَقّة تصميمية حقيقية اتصلحت هنا —
   * الترتيب القديم كان `ORDER BY average_rating DESC` مباشرة، يعني فني بتقييم 5.0 من تقييم واحد
   * بس كان بيسبق فني بتقييم 4.9 من مئات الطلبات المكتملة (بالظبط المثال المحذّر منه في Part 9).
   * الإصلاح: متوسط بايزي مرجّح بالثقة (Bayesian average) — كل فني عنده عدد تقييمات أقل من
   * `ranking.bayesian_min_samples` (افتراضي 5) بيتسحب score بتاعه ناحية `ranking.
   * bayesian_prior_mean` (افتراضي 4.0، متوسط منصف محافظ) بدل ما ياخد تقييمه الخام كامل الثقة.
   * الصيغة: `score = (v×R + m×C) / (v+m)` — v=عدد تقييماته، R=متوسطه، m=العتبة، C=المتوسط
   * الافتراضي. فني 5.0/تقييم واحد: `(1×5 + 5×4)/(1+5) = 4.17`. فني 4.9/200 تقييم:
   * `(200×4.9 + 5×4)/(200+5) = 4.878` — بيسبقه صح دلوقتي. القيم قابلة للتعديل من الأدمن
   * (`SettingsService`، بلا كود جديد) — نفس نمط أي وزن قابل للإعداد في المشروع.
   */
  async listForServiceBooking(
    serviceId: string,
    addressId: string,
    excludeTechnicianId?: string,
    scheduledAt?: Date | null,
    // docs/08 §38 (طلب مالك صريح 2026-08-21) — "اعتماد" لازم يفضل نفس قايمة "فردي" بالحرف إلا
    // فلترة مستوى الفني (محترف فأعلى، technician_level_config.eligible_for_team_booking). false
    // افتراضيًا (فردي/طوارئ) = صفر تغيير عن السلوك الحالي.
    isTeamBooking = false,
    includeCompanyEntities = true,
    // **ADR-0064 §3** — الحمل التشغيلي الحقيقي للحجز اللي العميل بيحضّره (ناتج محرك التسعير من
    // مدخلات الفورم). من غيره الفلترة بتفترض «يوم واحد» لأي حجز مهما كان مداه، فحجز 67 يوم كان
    // بيتفحص على يوم بدايته بس والفني المشغول في نص المدى يفضل ظاهر «متاح» (بلاغ المالك).
    candidateLoad?: CandidateOperationalLoad,
  ): Promise<{ zoneId: string; items: TechnicianBookingListItem[] }> {
    const zone = await this.resolveZoneForAddressOrThrow(addressId);

    const bayesianMinSamples = await this.settingsService.getNumber('ranking.bayesian_min_samples', 5);
    const bayesianPriorMean = await this.settingsService.getNumber('ranking.bayesian_prior_mean', 4.0);
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);

    interface TechnicianRow {
      technician_id: string;
      full_name: string;
      avatar_url: string | null;
      avatar_storage_key: string | null;
      bio: string | null;
      average_rating: string;
      total_ratings_count: number;
      service_completed_count: number;
      distance_km: string | null;
      current_level: TechnicianLevel;
      level_label_ar: string | null;
      pricing_tier: TechnicianPricingTier;
      is_trust_verified: boolean;
      on_time_rate: string | null;
      on_time_sample_count: string | null;
      avg_late_minutes: string | null;
      avg_arrival_minutes: string | null;
      total_completed_count: number | null;
      company_id: string | null;
      company_name: string | null;
      commercial_registration_number: string | null;
    }
    const rows = await this.technicianProfiles.manager.query<TechnicianRow[]>(
      `
      SELECT tp.id AS technician_id, u.full_name, u.avatar_url, u.avatar_storage_key, tp.bio,
             tp.average_rating, tp.total_ratings_count, COALESCE(ts.completed_count, 0) AS service_completed_count,
             ST_Distance(tp.current_location, a.location) / 1000.0 AS distance_km, tp.current_level, tp.pricing_tier,
             -- **اسم المستوى من الأدمن، مش مكتوب في التطبيق** (docs/08 §153): التطبيق كان
             -- عنده خريطة ثابتة بتقول «مميز» والأدمن ضابط «بريميوم» في نفس الوقت — قيمتين
             -- لنفس الحاجة، وأي تعديل من اللوحة مكانش بيوصل للعميل.
             tlc.display_name_ar AS level_label_ar,
             tp.is_trust_verified,
             company.id AS company_id, company.name AS company_name,
             company.commercial_registration_number,
             (tp.total_ratings_count * tp.average_rating + $5::int * $6::numeric) / NULLIF(tp.total_ratings_count + $5::int, 0)
               AS recommendation_score,
             -- Script 6 Part 7 — مؤشرات أداء حقيقية لكروت المقارنة في السوق (مش أرقام مصطنعة).
             -- نفس منطق getPublicProfile() بالحرف (technician_departed_at→technician_arrived_at،
             -- عتبة الالتزام 15 دقيقة) بس كـcorrelated subquery هنا عشان يشتغل لكل الفنيين المرشحين
             -- دفعة واحدة (LIMIT 50 أصلاً، والعمود مفهرس idx_orders_technician_id).
             (SELECT ROUND(
                COUNT(*) FILTER (WHERE o.technician_arrived_at <= o.scheduled_at + interval '15 minutes') * 100.0
                  / NULLIF(COUNT(*), 0)
              )
              FROM orders o
              WHERE o.technician_id = tp.id AND o.scheduled_at IS NOT NULL
                AND o.technician_arrived_at IS NOT NULL AND o.deleted_at IS NULL
             ) AS on_time_rate,
             -- **حجم العيّنة جزء من العقد** (ADR-0099): مية بالمية من زيارة واحدة مش زي مية
             -- بالمية من خمسين، والواجهة لازم تقدر تفرّق بدل ما تعرض رقم مضلّل.
             (SELECT COUNT(*)
              FROM orders o
              WHERE o.technician_id = tp.id AND o.scheduled_at IS NOT NULL
                AND o.technician_arrived_at IS NOT NULL AND o.deleted_at IS NULL
             ) AS on_time_sample_count,
             -- «متوسط تأخيره كام» بنص المالك — على **الزيارات المتأخرة وحدها**. المتوسط على
             -- الكل بيتخفّف بالزيارات اللي في معادها فيطلع رقم صغير مطمئن بالغلط.
             (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (o.technician_arrived_at - o.scheduled_at)) / 60))
              FROM orders o
              WHERE o.technician_id = tp.id AND o.scheduled_at IS NOT NULL
                AND o.technician_arrived_at IS NOT NULL AND o.deleted_at IS NULL
                AND o.technician_arrived_at > o.scheduled_at + interval '15 minutes'
             ) AS avg_late_minutes,
             -- **متوسط مدة الوصول لنفس المنطقة** (طلب المالك بالحرف)، وبيرجع للمتوسط العام لو
             -- لسه مفيش تاريخ في النطاق ده. الرقم ده تاريخي مش تنبؤ لحظي — الاسم والعرض
             -- بيقولوا كده صراحةً دلوقتي (ADR-0099).
             COALESCE(
               (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (o.technician_arrived_at - o.technician_departed_at)) / 60))
                FROM orders o
                WHERE o.technician_id = tp.id AND o.technician_departed_at IS NOT NULL
                  AND o.technician_arrived_at IS NOT NULL AND o.deleted_at IS NULL
                  AND o.service_zone_id = $2
               ),
               (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (o.technician_arrived_at - o.technician_departed_at)) / 60))
                FROM orders o
                WHERE o.technician_id = tp.id AND o.technician_departed_at IS NOT NULL
                  AND o.technician_arrived_at IS NOT NULL AND o.deleted_at IS NULL
               )
             ) AS avg_arrival_minutes,
             -- إجمالي شغل الفني على المنصّة كلها — مقابل service_completed_count اللي فوق
             -- وهو **للخدمة دي وحدها**. الاتنين كانوا بيتعرضوا كرقم واحد اسمه «طلب مكتمل»،
             -- فطلع «0 طلب مكتمل» جنب «4.4 (5)» — تناقض ظاهري مصدره خلط نطاقين.
             tp.completed_orders_count AS total_completed_count
      FROM technician_profiles tp
      JOIN users u ON u.id = tp.user_id
      -- ADR-0018 §8 — LEFT JOIN بدل INNER: أهلية الفني بقت "خدمة معتمدة مباشرة OR فئة الخدمة
      -- معتمدة" (شرط الـEXISTS تحت). فني معتمد بالفئة بس (بلا صف technician_services مباشر
      -- لنفس الخدمة دي بالذات) لازم يفضل يظهر هنا — ts.* بترجع NULL ليه وقتها (COALESCE فوق).
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN services svc ON svc.id = $1
      LEFT JOIN technician_level_config tlc ON tlc.level = tp.current_level
      LEFT JOIN technician_companies company ON company.id = tp.company_id
        AND company.is_active = true AND company.deleted_at IS NULL
      CROSS JOIN (SELECT location FROM addresses WHERE id = $3) a
      WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
        -- ADR-0087 — **مفيش استبعاد على أساس النوع**. المساعد المؤهّل وغير المحجوب عن الخدمة
        -- بيظهر للعميل كمقدّم خدمة زيه زي الفني؛ الحجب جوّه شرط التأهيل تحت هو اللي بيمنع.
        -- ADR-0018 §8 — التأهيل الأساسي: technician_services المباشر (فوق) أو تأهيل بمستوى
        -- الفئة كلها (سباكة/كهرباء/...، technician_categories) — نفس القاعدة اللي matching
        -- .service.ts وassistant-matching.service.ts وtechnician-assignment-guard.service.ts
        -- الثلاثة بيطبّقوها.
        AND ${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 'svc.id',
          categoryIdExpr: 'svc.category_id',
          directServiceAlias: 'ts',
          // ADR-0086 — القوايم دي بتختار **قائد** الطلب، فالاشتراط بيسري عليها.
          technicianLeadRule: { technicianAlias: 'tp', serviceRequiresLeadExpr: 'svc.requires_technician_lead' },
        })}
        -- بَقّة حقيقية اتلقطت (بلاغ المالك، 2026-08-19، سيناريو "يوسف") — القايمة دي كانت بترشّح
        -- فني للعرض/الاختيار اليدوي حتى لو معندوش current_location خالص (لسه مفتحش تطبيق الفني
        -- أبدًا)، بينما findEligibleTechnicians() في matching.service.ts (اللي فعليًا بتوزّع
        -- الطلب) بتشترط current_location IS NOT NULL صراحة — يعني عميل يقدر "يختار" فني هنا
        -- والتوزيع الفعلي بعد كده يرفضه تمامًا بصمت. current_location شرط أساسي مايتفاوضش عليه
        -- (لازمة لأي توزيع فعلي بغض النظر عن ASAP/مجدول)، فبقى شرط هنا كمان.
        AND tp.current_location IS NOT NULL
        -- ADR-0080 — الفني «الحصري للشركة» مايظهرش في قايمة الأفراد خالص؛ بيوصله شغل عن طريق
        -- شركته بس (فرع الشركات تحت مابيطبّقش الشرط ده عمدًا).
        AND ${technicianIndividualVisibilityCondition({ technicianAlias: 'tp' })}
        AND ($4::uuid IS NULL OR tp.id != $4)
        -- docs/08 §38 — نفس فلترة findEligibleTechnicians()/assertCoreEligibility() بالحرف، عشان
        -- قايمة التصفّح متعرضش فني هيترفض وقت التأكيد الفعلي. individual/emergency ($12=false)
        -- بلا أي تغيير عن السلوك الحالي.
        AND ($12::boolean IS NOT TRUE OR tlc.eligible_for_team_booking = true)
        -- ADR-0017 بند 4/6 (مُصحَّحة بـADR-0018) — نفس مصدر التوافر المستخدم في المطابقة الفعلية
        -- (matching.service.ts) وتعيين الأدمن القسري، عشان القايمة دي تعكس مين فعلاً هيتقبل
        -- فعليًا لليوم المطلوب، مش بس "مؤهّل بشكل عام". isEmergencyParam دايمًا false هنا —
        -- الشاشة دي بتظهر بس لأوضاع فردي/اعتماد (مش طوارئ، الطوارئ بتتوزّع تلقائيًا بلا اختيار
        -- عميل). excludeOrderIdParam = NULL حرفي — لسه مفيش طلب فعلي اتعمل، دي مرحلة تصفّح قبل الحجز.
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$7',
          excludeOrderIdParam: 'NULL',
          activeStatusesParam: '$8',
          engagedStatusesParam: '$9',
          isEmergencyParam: '$10',
          serviceDurationExpr: 'COALESCE($13::int, (SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1))',
          // ADR-0064 §3 — نفس شكل `MatchingService.findEligibleTechnicians()` بالحرف: أعمدة
          // المرشّح بتتبعت كـparameters، والقاعدة نفسها بتتطبّق عليها جوّه المحرك المشترك.
          candidateLoad: {
            estimatedDurationDaysExpr: '$14::numeric',
            durationMinutesExpr: '$13::int',
            serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
          },
          // ADR-0077 — القايمة دي كانت بتشوف السقف اليومي بس، فكانت بتعرض فني محجوز في نفس
          // الساعة بالظبط. المدة الحقيقية للمرشّح بتحوّل الفحص لتقاطع وقت فعلي — نفس اللي
          // التوزيع والتعيين بيعملوه، فالثلاثة بيدّوا نفس الإجابة.
          preciseDurationHoursExpr: '$13::numeric / 60.0',
          dailyCapacityMinutesParam: '$11',
        })}
      ORDER BY recommendation_score DESC NULLS LAST, distance_km ASC NULLS LAST, COALESCE(ts.completed_count, 0) DESC
      LIMIT 50
      `,
      [
        serviceId,
        zone.id,
        addressId,
        excludeTechnicianId ?? null,
        bayesianMinSamples,
        bayesianPriorMean,
        scheduledAt ?? null,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        dailyCapacityMinutes,
        isTeamBooking,
        candidateLoad?.durationMinutes ?? null,
        candidateLoad?.estimatedDurationDays ?? null,
      ],
    );

    const individualItems: TechnicianBookingListItem[] = rows.map((row) => ({
      technicianId: row.technician_id,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      avatarStorageKey: row.avatar_storage_key,
      bio: row.bio,
      averageRating: Number(row.average_rating),
      totalRatingsCount: row.total_ratings_count,
      serviceCompletedCount: row.service_completed_count,
      distanceKm: row.distance_km !== null ? Number(row.distance_km) : null,
      currentLevel: row.current_level,
      currentLevelLabelAr: row.level_label_ar,
      pricingTier: row.pricing_tier,
      // ADR-0039 — مِنحة إدارية، مش مشتقة من verification_status. الفلتر فوق بيضمن إن الفني
      // مؤهّل تشغيليًا (وده شرط ظهوره أصلاً)، والعمود ده بيقول إن الأدمن اختاره يستاهل العلامة.
      isVerified: row.is_trust_verified,
      onTimeRatePercent: row.on_time_rate !== null ? Number(row.on_time_rate) : null,
      onTimeSampleCount: row.on_time_sample_count !== null ? Number(row.on_time_sample_count) : 0,
      avgLateMinutes: row.avg_late_minutes !== null ? Number(row.avg_late_minutes) : null,
      avgArrivalMinutes: row.avg_arrival_minutes !== null ? Number(row.avg_arrival_minutes) : null,
      totalCompletedCount: row.total_completed_count ?? 0,
      isCompany: false,
      staffCount: null,
      branchCount: null,
      companyId: row.company_id,
      companyName: row.company_name,
      isCommercialCompany: Boolean(row.commercial_registration_number?.trim()),
      availabilityStatus: 'available',
      unavailableReasonAr: null,
      availableAgainAt: null,
    }));

    // سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030، docs/08 §42) — دلو إضافي منفصل تمامًا
    // عن الاستعلام فوق، بيتفعّل بس لو الخدمة مفعّلة له صراحة (الافتراضي false = صفر تغيير سلوك،
    // صفر استعلام إضافي حتى). "متعارض" هنا يعني حرفيًا `technicianScheduleConflictCondition()` —
    // مؤهّل فعلاً بس مشغول بشغل تاني، مش `blocked`/غير مؤهّل (دول يفضلوا مخفيين تمامًا زي زمان).
    const conflictedItems =
      scheduledAt && (await this.services.findOne({ where: { id: serviceId } }))?.showUnavailableProviders
        ? await this.findScheduleConflictedTechnicians(
            serviceId,
            zone.id,
            addressId,
            scheduledAt,
            individualItems.map((i) => i.technicianId),
            isTeamBooking,
            dailyCapacityMinutes,
            candidateLoad,
          )
        : [];

    // اندماج الشركات في نفس قايمة "اعتماد" (docs/08 §38، طلب مالك صريح: "الشركات بتظهر كده كده
    // أساسي في اعتماد، زي شخص عادي جدًا"). individual/emergency (isTeamBooking=false) بلا أي
    // تغيير — الشركة كوحدة حجز مالهاش معنى واضح لـ"فني واحد بيتولى الشغلانة بنفسه" أو التوزيع
    // الفوري. بلا فلتر مستوى هنا عمداً — الشركة أصلاً موثوقة كوحدة (مالكها/مديرها لازم كان
    // premium+ وقت الإنشاء، technician-companies.service.ts's canLeadTeam check)، وطلب المالك
    // كان "الشركات بتظهر كده كده" بلا أي شرط إضافي.
    // ADR-0080 (طلب مالك، 2026-09-06: «لما بدخل أحجز أي خدمة مش بشوف الشركات») — الشركات بقت
    // تظهر في **كل** حجز يقدر العميل يختار فيه منفّذ، مش «اعتماد» بس. الشرط القديم كان
    // `!isTeamBooking || !includeCompanyEntities`، و`allows_team` مقفول على كل الخدمات فعليًا،
    // فالشركات كانت غير مرئية بالكامل. الكولر هو اللي بيقرر (`includeCompanyEntities`) — إعادة
    // التعيين واختيار المنفّذ بعد العرض لسه بيستبعدوها عمدًا لأسبابهم الموثّقة.
    if (!includeCompanyEntities) {
      return {
        zoneId: zone.id,
        items: dedupeTechnicianBookingItems([...individualItems, ...conflictedItems]),
      };
    }

    interface CompanyRow {
      company_id: string;
      name: string;
      avg_rating: string | null;
      total_ratings: string | null;
      distance_km: string | null;
      staff_count: string;
      branch_count: string;
      completed_count: string | null;
      is_trust_verified: boolean;
      commercial_registration_number: string | null;
      price_multiplier: string;
    }
    const companyRows = await this.technicianProfiles.manager.query<CompanyRow[]>(
      `
      SELECT tc.id AS company_id, tc.name, tc.commercial_registration_number, tc.is_trust_verified,
             -- ADR-0042 — معامل سعر الشركة بيتحمّل مع القايمة عشان السعر المعروض في المقارنة
             -- يبقى السعر الحقيقي بتاعها، مش السعر الأساسي المشترك.
             tc.price_multiplier,
             AVG(tp.average_rating) AS avg_rating,
             SUM(tp.total_ratings_count) AS total_ratings,
             -- docs/08 §62.2 — كان 0 ثابت في طبقة العرض (رقم كاذب معروض للعميل). الـLEFT JOIN
             -- على ts صف واحد بالكتير لكل عضو، فالمجموع هنا = طلبات الشركة المكتملة في الخدمة دي.
             SUM(COALESCE(ts.completed_count, 0)) AS completed_count,
             MIN(ST_Distance(tp.current_location, a.location) / 1000.0) AS distance_km,
             (SELECT COUNT(*) FROM technician_profiles WHERE company_id = tc.id) AS staff_count,
             (SELECT COUNT(*) FROM technician_company_branches WHERE company_id = tc.id) AS branch_count
      FROM technician_companies tc
      -- نفس شروط أهلية الفرد بالحرف (خدمة/فئة، منطقة، current_location، توافر) فوق، **بدون**
      -- فلتر مستوى — على الأقل عضو واحد مؤهّل فعليًا للخدمة/المنطقة/الموعد ده كافي عشان الشركة
      -- تظهر (الفني الفعلي اللي هيبقى قائد المهمة بيتحدد وقت التوزيع الحقيقي، مش هنا).
      JOIN technician_profiles tp ON tp.company_id = tc.id
        AND tp.verification_status = 'approved' AND tp.deleted_at IS NULL
        AND tp.current_location IS NOT NULL
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN services svc ON svc.id = $1
      CROSS JOIN (SELECT location FROM addresses WHERE id = $3) a
      WHERE tc.is_active = true
        -- ADR-0087 — نفس قاعدة القايمة الأساسية: الحجب هو اللي بيمنع القيادة، مش النوع.
        AND ${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 'svc.id',
          categoryIdExpr: 'svc.category_id',
          directServiceAlias: 'ts',
          // ADR-0086 — القوايم دي بتختار **قائد** الطلب، فالاشتراط بيسري عليها.
          technicianLeadRule: { technicianAlias: 'tp', serviceRequiresLeadExpr: 'svc.requires_technician_lead' },
        })}
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$4',
          excludeOrderIdParam: 'NULL',
          activeStatusesParam: '$5',
          engagedStatusesParam: '$6',
          isEmergencyParam: '$7',
          serviceDurationExpr: 'COALESCE($9::int, (SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1))',
          candidateLoad: {
            estimatedDurationDaysExpr: '$10::numeric',
            durationMinutesExpr: '$9::int',
            serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
          },
          // ADR-0077 — القايمة دي كانت بتشوف السقف اليومي بس، فكانت بتعرض فني محجوز في نفس
          // الساعة بالظبط. المدة الحقيقية للمرشّح بتحوّل الفحص لتقاطع وقت فعلي — نفس اللي
          // التوزيع والتعيين بيعملوه، فالثلاثة بيدّوا نفس الإجابة.
          preciseDurationHoursExpr: '$9::numeric / 60.0',
          dailyCapacityMinutesParam: '$8',
        })}
      GROUP BY tc.id, tc.name
      LIMIT 20
      `,
      [
        serviceId,
        zone.id,
        addressId,
        scheduledAt ?? null,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        dailyCapacityMinutes,
        candidateLoad?.durationMinutes ?? null,
        candidateLoad?.estimatedDurationDays ?? null,
      ],
    );

    const companyItems: TechnicianBookingListItem[] = companyRows.map((row) => ({
      technicianId: row.company_id,
      fullName: row.name,
      avatarUrl: null,
      avatarStorageKey: null,
      bio: null,
      averageRating: row.avg_rating !== null ? Number(row.avg_rating) : 0,
      totalRatingsCount: row.total_ratings !== null ? Number(row.total_ratings) : 0,
      serviceCompletedCount: Number(row.completed_count ?? 0),
      distanceKm: row.distance_km !== null ? Number(row.distance_km) : null,
      // تمثيلي بس (مفيش فني محدد بعد) — أعلى مستوى عشان مايتفسّرش غلط كـ"تحت محترف".
      currentLevel: TechnicianLevel.TEAM_LEADER,
      // الشركة مالهاش مستوى حقيقي (ADR-0042) — الكارت بيعرض «شركة مسجّلة/فريق عمل» بدلاً منه.
      currentLevelLabelAr: null,
      // تمثيلي بس زي currentLevel فوق — estimate() أصلاً مبيتحسبش للشركات (isCompany:true بترجع
      // estimate:null في catalog.controller.ts)، فالقيمة دي مالهاش أي أثر على السعر المعروض.
      pricingTier: TechnicianPricingTier.STANDARD,
      // ADR-0039 — نفس المِنحة الإدارية بالظبط، بس من technician_companies.
      isVerified: row.is_trust_verified,
      onTimeRatePercent: null,
      onTimeSampleCount: 0,
      avgLateMinutes: null,
      avgArrivalMinutes: null,
      totalCompletedCount: 0,
      isCompany: true,
      // ADR-0042 — بيتبعت لـestimate() بدل مضاعف المستوى.
      companyPriceMultiplier: Number(row.price_multiplier ?? 1),
      staffCount: Number(row.staff_count),
      branchCount: Number(row.branch_count),
      companyId: row.company_id,
      companyName: row.name,
      isCommercialCompany: Boolean(row.commercial_registration_number?.trim()),
      availabilityStatus: 'available',
      unavailableReasonAr: null,
      availableAgainAt: null,
    }));

    /**
     * **ترتيب موحّد بنفس مقياس الترشيح البايزي** — مش «تقييم خام ثم قرب».
     *
     * الترتيب القديم كان بيعيد فرز الأفراد بالتقييم الخام، فبيرمي `recommendation_score`
     * البايزي اللي الاستعلام حسبه (`(n·r + m·C) / (n + m)`). كان أثره محدود لأن المسار ده كان
     * بيشتغل في «اعتماد» بس؛ بعد ADR-0080 (الشركات بتظهر في كل حجز) بقى بيضرب **كل** قايمة —
     * وده كان بيرجّع بالظبط البَقّة اللي Script 6 Part 9 اتعمل عشانها: فني 5.0 بتقييم واحد
     * بيسبق فني 4.9 بمئتين تقييم.
     *
     * الحل: نفس الصيغة بالحرف على الطرفين. الشركة عندها `average_rating` و`total_ratings`
     * مجمّعين من أعضائها، فالمقياس ينطبق عليها من غير أي اختراع.
     */
    const bayesianScore = (rating: number, ratingsCount: number): number =>
      (ratingsCount * rating + bayesianMinSamples * bayesianPriorMean) / (ratingsCount + bayesianMinSamples || 1);
    // المتعارضين (ADR-0030) بيتضافوا آخر القايمة دايمًا (بغض النظر عن تقييمهم) — مؤهّل ومتاح فعلاً
    // لازم يفضل ظاهر أولاً، "متعارض" معلومة إضافية مش بديل عن الترتيب العادي.
    const merged = [...individualItems, ...companyItems].sort((a, b) => {
      const scoreDelta =
        bayesianScore(b.averageRating, b.totalRatingsCount) - bayesianScore(a.averageRating, a.totalRatingsCount);
      if (Math.abs(scoreDelta) > 1e-9) return scoreDelta;
      const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
      return da - db;
    });

    return {
      zoneId: zone.id,
      items: dedupeTechnicianBookingItems([...merged, ...conflictedItems]),
    };
  }

  /**
   * **ليه القايمة طلعت فاضية؟** — عدّاد مراحل على نفس بوابة الأهلية، مش محرك تاني.
   *
   * لما `listForServiceBooking()` ترجّع صفر، «مفيش فنيين متاحين» بتخفي سبع احتمالات مختلفة
   * تمامًا، وكل واحد له علاج مختلف: الفني مش مؤهّل للخدمة، مش متعيّن على النطاق، مفتحش
   * التطبيق فمفيش GPS، مستواه مش مسموح لحجز الفريق، مشغول بشغل تاني وقتها، حاجز اليوم
   * لنفسه، أو عدّى سقفه اليومي.
   *
   * **الضمان اللي بيخلّي ده مفيد بدل مضلّل**: كل مرحلة هنا بتستخدم **نفس دالة الشرط المستوردة**
   * اللي الاستعلام الحقيقي بيستخدمها بالحرف، وبنفس الـparameters — مفيش أي قاعدة عمل مكتوبة
   * تاني هنا. لو الشرط اتغيّر في `technician-eligibility.sql.ts`، التشخيص بيتغيّر معاه تلقائيًا.
   * العدّ **تراكمي** (كل مرحلة بتضيف شرطها لللي قبلها)، فأول رقم بيقع لصفر هو السبب الأساسي.
   *
   * أداة تطوير/اختبار — بتتنادى من الـcontroller لما القايمة تطلع فاضية في غير الإنتاج، ومن
   * الاختبارات مباشرةً. (بلاغ مالك 2026-09-19)
   */
  async diagnoseBookingCandidatePool(opts: {
    serviceId: string;
    addressId: string;
    scheduledAt: Date | null;
    isTeamBooking: boolean;
    candidateLoad?: CandidateOperationalLoad;
  }): Promise<BookingCandidatePoolDiagnosis> {
    const { serviceId, addressId, scheduledAt, isTeamBooking, candidateLoad } = opts;
    const zone = await this.resolveZoneForAddressOrThrow(addressId);
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);

    const serviceDurationExpr =
      'COALESCE($9::int, (SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1))';
    const availabilityArgs = {
      technicianIdExpr: 'tp.id',
      scheduledAtParam: '$3',
      excludeOrderIdParam: 'NULL',
      activeStatusesParam: '$4',
      engagedStatusesParam: '$5',
      isEmergencyParam: '$6',
      serviceDurationExpr,
      candidateLoad: {
        estimatedDurationDaysExpr: '$10::numeric',
        durationMinutesExpr: '$9::int',
        serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
      },
      preciseDurationHoursExpr: '$9::numeric / 60.0',
      dailyCapacityMinutesParam: '$7',
    } as const;

    // نفس شروط الاستعلام الحقيقي، كل واحد كـflag على نفس الصف — التراكم بيتم في الـSELECT تحت.
    const qualified = technicianServiceQualificationCondition({
      technicianIdExpr: 'tp.id',
      serviceIdExpr: 'svc.id',
      categoryIdExpr: 'svc.category_id',
      directServiceAlias: 'ts',
      technicianLeadRule: { technicianAlias: 'tp', serviceRequiresLeadExpr: 'svc.requires_technician_lead' },
    });
    const visible = technicianIndividualVisibilityCondition({ technicianAlias: 'tp' });
    const notBlocked = `NOT ${blockedExistsExpr({
      technicianIdExpr: 'tp.id',
      scheduledAtParam: '$3',
      serviceDurationExpr,
      dailyCapacityMinutesParam: '$7',
      candidateLoad: availabilityArgs.candidateLoad,
    })}`;
    // السقف اليومي جزء من تعبير التعارض نفسه، فبيتحسب لوحده هنا عشان «مشغول في الموعد»
    // و«عدّى سقفه اليومي» مايتلموش في سبب واحد — كل واحد فيهم له علاج مختلف تمامًا.
    const capacityExceeded = dailyCapacityExceededExpr({
      technicianIdExpr: 'tp.id',
      activeStatusesParam: '$4',
      excludeOrderIdParam: 'NULL',
      dailyCapacityParam: '$7',
      scheduledAtParam: '$3',
      candidateLoad: availabilityArgs.candidateLoad,
    });
    const anyConflict = activeOrderConflictExistsExpr({
      technicianIdExpr: 'tp.id',
      scheduledAtParam: '$3',
      excludeOrderIdParam: 'NULL',
      activeStatusesParam: '$4',
      engagedStatusesParam: '$5',
      isEmergencyParam: '$6',
      serviceDurationExpr,
      preciseDurationHoursExpr: availabilityArgs.preciseDurationHoursExpr,
      dailyCapacityMinutesParam: '$7',
      candidateLoad: availabilityArgs.candidateLoad,
    });
    // تعبير التعارض = (تقاطع وقت) OR (تجاوز السقف). طرح السقف منه بيسيب التقاطع الوقتي لوحده،
    // والمرحلة اللي بعديها بتطرح السقف — فأول صفر بيسمّي السبب الحقيقي مش المجموع.
    const noTimeConflict = `(NOT (${anyConflict}) OR (${capacityExceeded}))`;
    const fullyAvailable = technicianAvailabilityCondition(availabilityArgs).replace(/^\s*AND\s+/, '');

    interface DiagnosisRow {
      in_zone: string;
      qualified: string;
      has_location: string;
      individually_visible: string;
      team_level_ok: string;
      no_schedule_conflict: string;
      not_blocked: string;
      available: string;
    }
    const [row] = await this.technicianProfiles.manager.query<DiagnosisRow[]>(
      `
      SELECT
        COUNT(*)::text AS in_zone,
        COUNT(*) FILTER (WHERE ${qualified})::text AS qualified,
        COUNT(*) FILTER (WHERE ${qualified} AND tp.current_location IS NOT NULL)::text AS has_location,
        COUNT(*) FILTER (WHERE ${qualified} AND tp.current_location IS NOT NULL
                           AND ${visible})::text AS individually_visible,
        COUNT(*) FILTER (WHERE ${qualified} AND tp.current_location IS NOT NULL AND ${visible}
                           AND ($8::boolean IS NOT TRUE OR tlc.eligible_for_team_booking = true))::text AS team_level_ok,
        COUNT(*) FILTER (WHERE ${qualified} AND tp.current_location IS NOT NULL AND ${visible}
                           AND ($8::boolean IS NOT TRUE OR tlc.eligible_for_team_booking = true)
                           AND ${notBlocked})::text AS not_blocked,
        COUNT(*) FILTER (WHERE ${qualified} AND tp.current_location IS NOT NULL AND ${visible}
                           AND ($8::boolean IS NOT TRUE OR tlc.eligible_for_team_booking = true)
                           AND ${notBlocked} AND ${noTimeConflict})::text AS no_schedule_conflict,
        COUNT(*) FILTER (WHERE ${qualified} AND tp.current_location IS NOT NULL AND ${visible}
                           AND ($8::boolean IS NOT TRUE OR tlc.eligible_for_team_booking = true)
                           AND ${fullyAvailable})::text AS available
      FROM technician_profiles tp
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN services svc ON svc.id = $1
      LEFT JOIN technician_level_config tlc ON tlc.level = tp.current_level
      WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
      `,
      [
        serviceId,
        zone.id,
        scheduledAt ?? null,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        dailyCapacityMinutes,
        isTeamBooking,
        candidateLoad?.durationMinutes ?? null,
        candidateLoad?.estimatedDurationDays ?? null,
      ],
    );

    const stages: BookingCandidatePoolStage[] = [
      { stage: 'in_zone', labelAr: 'فنيين معتمدين متعيّنين على النطاق', remaining: Number(row?.in_zone ?? 0) },
      { stage: 'qualified', labelAr: 'مؤهّلين للخدمة/الفئة (وشرط القيادة لو مطلوب)', remaining: Number(row?.qualified ?? 0) },
      { stage: 'has_location', labelAr: 'عندهم موقع GPS مسجّل', remaining: Number(row?.has_location ?? 0) },
      { stage: 'individually_visible', labelAr: 'مش حصريين لشركة', remaining: Number(row?.individually_visible ?? 0) },
      { stage: 'team_level_ok', labelAr: 'مستواهم مسموح لوضع الحجز', remaining: Number(row?.team_level_ok ?? 0) },
      { stage: 'not_blocked', labelAr: 'مش حاجزين الموعد ده لنفسهم', remaining: Number(row?.not_blocked ?? 0) },
      { stage: 'no_schedule_conflict', labelAr: 'مش مشغولين بشغل تاني في الموعد', remaining: Number(row?.no_schedule_conflict ?? 0) },
      { stage: 'available', labelAr: 'تحت السقف اليومي (متاحين فعلاً)', remaining: Number(row?.available ?? 0) },
    ];
    // أول مرحلة وصلت لصفر هي السبب الأساسي — اللي بعدها بيبقى صفر بالتبعية مش باستحقاق.
    const firstBlockingStage = stages.find((s) => s.remaining === 0)?.stage ?? null;
    return { zoneId: zone.id, scheduledAt, stages, firstBlockingStage };
  }

  /**
   * "مؤهّل بس متعارض جدوليًا" (ADR-0030) — نفس بوابة الأهلية الصارمة اللي `listForServiceBooking()`
   * فوق بتستخدمها بالحرف (خدمة/فئة، منطقة، `current_location`)، الفرق الوحيد شرط التوافر
   * (`technicianScheduleConflictCondition()` بدل `technicianAvailabilityCondition()`) + استبعاد
   * أي فني ظهر بالفعل في الدلو "متاح" (`excludeTechnicianIds`). محدودة (`LIMIT 10`) — معلومة
   * إضافية للعميل، مش قايمة أساسية يستاهل تحميل كامل زيها.
   */
  private async findScheduleConflictedTechnicians(
    serviceId: string,
    zoneId: string,
    addressId: string,
    scheduledAt: Date,
    excludeTechnicianIds: string[],
    isTeamBooking: boolean,
    dailyCapacityMinutes: number,
    candidateLoad: CandidateOperationalLoad | undefined,
  ): Promise<TechnicianBookingListItem[]> {
    interface ConflictedRow {
      technician_id: string;
      full_name: string;
      avatar_url: string | null;
      avatar_storage_key: string | null;
      bio: string | null;
      average_rating: string;
      total_ratings_count: number;
      distance_km: string | null;
      current_level: TechnicianLevel;
      pricing_tier: TechnicianPricingTier;
      is_trust_verified: boolean;
      company_id: string | null;
      company_name: string | null;
      commercial_registration_number: string | null;
    }
    const rows = await this.technicianProfiles.manager.query<ConflictedRow[]>(
      `
      SELECT tp.id AS technician_id, u.full_name, u.avatar_url, u.avatar_storage_key, tp.bio,
             tp.average_rating, tp.total_ratings_count,
             ST_Distance(tp.current_location, a.location) / 1000.0 AS distance_km, tp.current_level, tp.pricing_tier,
             tp.is_trust_verified,
             company.id AS company_id, company.name AS company_name, company.commercial_registration_number
      FROM technician_profiles tp
      JOIN users u ON u.id = tp.user_id
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN services svc ON svc.id = $1
      LEFT JOIN technician_level_config tlc ON tlc.level = tp.current_level
      LEFT JOIN technician_companies company ON company.id = tp.company_id
        AND company.is_active = true AND company.deleted_at IS NULL
      CROSS JOIN (SELECT location FROM addresses WHERE id = $3) a
      WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
        -- ADR-0087 — نفس قاعدة القايمة الأساسية: مفيش استبعاد على أساس الدور.
        AND ${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 'svc.id',
          categoryIdExpr: 'svc.category_id',
          directServiceAlias: 'ts',
          // ADR-0086 — القوايم دي بتختار **قائد** الطلب، فالاشتراط بيسري عليها.
          technicianLeadRule: { technicianAlias: 'tp', serviceRequiresLeadExpr: 'svc.requires_technician_lead' },
        })}
        AND tp.current_location IS NOT NULL
        -- ADR-0080 — نفس قاعدة قايمة الأفراد فوق: الحصري للشركة مايظهرش حتى كـ«متعارض جدوليًا».
        AND ${technicianIndividualVisibilityCondition({ technicianAlias: 'tp' })}
        AND NOT (tp.id = ANY($9::uuid[]))
        AND ($10::boolean IS NOT TRUE OR tlc.eligible_for_team_booking = true)
        ${technicianScheduleConflictCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$4',
          excludeOrderIdParam: 'NULL',
          activeStatusesParam: '$5',
          engagedStatusesParam: '$6',
          isEmergencyParam: '$7',
          serviceDurationExpr: 'COALESCE($11::int, (SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1))',
          // ADR-0064 §3 — «متعارض» هو **العكس الدقيق** لـ«متاح»، فلازم يتقاس بنفس الحمل بالظبط.
          // لو الاتنين اتقاسوا بمسطرتين، فني ممكن يقع بره القايمتين (لا متاح ولا متعارض) فيختفي
          // من شاشة العميل تمامًا بلا أي سبب معروض.
          candidateLoad: {
            estimatedDurationDaysExpr: '$12::numeric',
            durationMinutesExpr: '$11::int',
            serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
          },
          // ADR-0077 — القايمة دي كانت بتشوف السقف اليومي بس، فكانت بتعرض فني محجوز في نفس
          // الساعة بالظبط. المدة الحقيقية للمرشّح بتحوّل الفحص لتقاطع وقت فعلي — نفس اللي
          // التوزيع والتعيين بيعملوه، فالثلاثة بيدّوا نفس الإجابة.
          preciseDurationHoursExpr: '$11::numeric / 60.0',
          dailyCapacityMinutesParam: '$8',
        })}
      ORDER BY average_rating DESC, distance_km ASC NULLS LAST
      LIMIT 10
      `,
      [
        serviceId,
        zoneId,
        addressId,
        scheduledAt,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        dailyCapacityMinutes,
        excludeTechnicianIds,
        isTeamBooking,
        candidateLoad?.durationMinutes ?? null,
        candidateLoad?.estimatedDurationDays ?? null,
      ],
    );

    // نفس بَقّة يوم UTC اللي في `findNextAvailableDateForTechnician` (ADR-0059 §6): اليوم ده
    // بيتبعت لـ`describeTechnicianCapacity` كـ«اليوم المطلوب»، فقراءته بتوقيت UTC كانت بتسأل
    // عن **يوم تاني** خالص في أول/آخر ساعات اليوم المصري.
    const dateOnly = cairoDayString(scheduledAt);
    return Promise.all(
      rows.map(async (row): Promise<TechnicianBookingListItem> => {
        const capacity = await describeTechnicianCapacity(this.technicianProfiles.manager, {
          technicianId: row.technician_id,
          date: dateOnly,
          dailyCapacityMinutes: dailyCapacityMinutes,
        });
        // بَقّة حقيقية اتلقطت (بلاغ مالك، docs/08 §108 بند I2): الاقتراح كان أحيانًا بيرجّع
        // **نفس اليوم** اللي العميل بيحاول يحجزه أصلًا — عديم الفايدة تمامًا («جرّب يوم كذا»
        // وهو نفسه اليوم المرفوض). السبب: `occupiedTo` (لو موجود) ممكن يرجع قبل `scheduledAt`
        // نفسه — أرضية `Math.max` هنا تضمن إن البحث عن اليوم البديل يبدأ من **الأحدث بين
        // الاتنين** دايمًا، بغض النظر عن أي انحراف توقيت.
        // البحث بيبدأ من **اليوم المصري اللي بعد** آخر يوم مشغول (أو بعد اليوم المطلوب لو
        // مفيش مدى مشغول معروف) — بالأيام التقويمية المصرية، مش بجمع 24 ساعة على طابع زمني.
        const occupiedToDay = capacity.occupiedTo;
        const requestedDay = cairoDayString(scheduledAt);
        const lastBusyDay = occupiedToDay && occupiedToDay > requestedDay ? occupiedToDay : requestedDay;
        const nextAvailable = await this.findNextAvailableDateForTechnician(
          row.technician_id,
          serviceId,
          zoneId,
          addressId,
          new Date(cairoMidnight(lastBusyDay).getTime() + 24 * 60 * 60 * 1000),
          undefined,
          // ADR-0064 §3 — «متاح تاني إمتى؟» لازم يجاوب على **نفس الحجز** اللي العميل بيحاوله،
          // مش على شغلانة افتراضية يوم واحد. من غير كده الاقتراح ممكن يرجّع يوم فاضي ليوم واحد
          // بس، والعميل يحاول فيه فيترفض تاني.
          candidateLoad,
        );
        // شبكة أمان أخيرة — لو رغم كل ده الاقتراح طلع بنفس تاريخ اليوم المطلوب (نفس التنسيق
        // المستخدم فوق في `dateOnly`)، بلاش نعرضه: مفيش اقتراح أوضح من عدم عرض اقتراح غلط.
        const safeNextAvailable = nextAvailable === dateOnly ? null : nextAvailable;
        return {
          technicianId: row.technician_id,
          fullName: row.full_name,
          avatarUrl: row.avatar_url,
          avatarStorageKey: row.avatar_storage_key,
          bio: row.bio,
          averageRating: Number(row.average_rating),
          totalRatingsCount: row.total_ratings_count,
          serviceCompletedCount: 0,
          distanceKm: row.distance_km !== null ? Number(row.distance_km) : null,
          currentLevel: row.current_level,
          // استعلام الصفوف المتعارضة مابيجيبش اسم المستوى (تشخيصي، مش كارت كامل) — الواجهة
          // بترجع لاسم المستوى الخام لو الحقل فاضي.
          currentLevelLabelAr: null,
          pricingTier: row.pricing_tier,
          isVerified: row.is_trust_verified,
          onTimeRatePercent: null,
          onTimeSampleCount: 0,
          avgLateMinutes: null,
          avgArrivalMinutes: null,
          totalCompletedCount: 0,
          isCompany: false,
          staffCount: null,
          branchCount: null,
          companyId: row.company_id,
          companyName: row.company_name,
          isCommercialCompany: Boolean(row.commercial_registration_number?.trim()),
          availabilityStatus: 'schedule_conflicted',
          // docs/08 §108 بند I1 — `capacity.reasonAr` (`describeTechnicianCapacity`) نص إداري
          // بالتصميم (docs comment بتاعه صريح: "جاهز للعرض المباشر في شاشة الأدمن") — مصطلحات
          // زي "مؤهّل للتأكيد التلقائي" أو "لسه مؤهّل لفرصة اختيارية" أو رقم طلب حد تاني كانت
          // بتوصل للعميل حرفيًا. العميل مش محتاج يعرف السبب التقني، محتاج بس يعرف إن الفني ده
          // مش هيقدر ياخد الطلب دلوقتي — نفس رسالة واحدة بسيطة لكل الحالات.
          unavailableReasonAr: 'الفني ده مش متاح في الوقت ده',
          availableAgainAt: safeNextAvailable,
        };
      }),
    );
  }

  /**
   * فحص وجود خفيف (`EXISTS` بس، بلا ترتيب بايزي ولا subqueries إحصائية) — دوس §32.3 docs/08:
   * "مرن — اختار نطاق أيام" في `apps/customer-app` بيحتاج يفحص يوم بيوم داخل نطاق (لحد 14 يوم)
   * عشان يلاقي أقرب يوم فيه فني مؤهّل واحد على الأقل، فلازم استعلام رخيص يتكرر بأمان — نسخة كاملة
   * زي `listForServiceBooking()` (ترتيب توصية بايزي + subqueries التزام بالمواعيد) غالية جدًا
   * تتكرر لحد 14 مرة. نفس شروط الأهلية الأساسية بالحرف (خدمة/فئة، منطقة، `current_location`،
   * `technicianAvailabilityCondition()` الموحّدة).
   */
  /**
   * `technicianId` اختياري (ADR-0030) — لو موجود، بيقيّد الفحص على فني بعينه بدل "أي فني" — نفس
   * الاستعلام بالحرف، استخدام مختلف بس (`findNextAvailableDateForTechnician()` تحت بتلف حواليه).
   */
  async hasEligibleTechnicianForDate(
    serviceId: string,
    zoneId: string,
    addressId: string,
    date: Date,
    technicianId?: string,
    excludeOrderId?: string,
    candidateLoad?: CandidateOperationalLoad,
  ): Promise<boolean> {
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const [{ exists }] = await this.technicianProfiles.manager.query<{ exists: boolean }[]>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM technician_profiles tp
        LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
          AND ts.verification_status = 'approved'
        JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
        JOIN services svc ON svc.id = $1
        CROSS JOIN (SELECT location FROM addresses WHERE id = $3) a
        WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
          -- ADR-0087 — «فيه حد متاح اليوم ده؟» بتشمل المساعدين، لأنهم بياخدوا شغل فعلاً.
          AND ${technicianServiceQualificationCondition({
            technicianIdExpr: 'tp.id',
            serviceIdExpr: 'svc.id',
            categoryIdExpr: 'svc.category_id',
            directServiceAlias: 'ts',
            // ADR-0086 — «فيه حد متاح اليوم ده؟» سؤال عن قائد محتمل، فالاشتراط بيسري.
            technicianLeadRule: { technicianAlias: 'tp', serviceRequiresLeadExpr: 'svc.requires_technician_lead' },
          })}
          AND tp.current_location IS NOT NULL
          -- ADR-0080 — «فيه حد متاح اليوم ده؟» سؤال عن الأفراد، فالحصري للشركة مايتحسبش.
          -- الاستثناء: لما السؤال عن فني **بعينه** ($9)، بيتجاوب عنه زي ما هو — الدالة دي
          -- بتخدم اقتراح مواعيد لفني متعيّن بالفعل، وإخفاؤه هناك بيكسر إعادة جدولة طلب شركة.
          AND ($9::uuid IS NOT NULL OR ${technicianIndividualVisibilityCondition({ technicianAlias: 'tp' })})
          AND ($9::uuid IS NULL OR tp.id = $9)
          ${technicianAvailabilityCondition({
            technicianIdExpr: 'tp.id',
            scheduledAtParam: '$4',
            excludeOrderIdParam: '$10',
            activeStatusesParam: '$5',
            engagedStatusesParam: '$6',
            isEmergencyParam: '$7',
            serviceDurationExpr: 'COALESCE($11::int, (SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1))',
            candidateLoad: {
              estimatedDurationDaysExpr: '$12::numeric',
              durationMinutesExpr: '$11::int',
              serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
            },
            // ADR-0077 — القايمة دي كانت بتشوف السقف اليومي بس، فكانت بتعرض فني محجوز في نفس
            // الساعة بالظبط. المدة الحقيقية للمرشّح بتحوّل الفحص لتقاطع وقت فعلي — نفس اللي
            // التوزيع والتعيين بيعملوه، فالثلاثة بيدّوا نفس الإجابة.
            preciseDurationHoursExpr: '$11::numeric / 60.0',
            dailyCapacityMinutesParam: '$8',
          })}
      ) AS exists
      `,
      [
        serviceId,
        zoneId,
        addressId,
        date,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        dailyCapacityMinutes,
        technicianId ?? null,
        excludeOrderId ?? null,
        candidateLoad?.durationMinutes ?? null,
        candidateLoad?.estimatedDurationDays ?? null,
      ],
    );
    return exists;
  }

  /**
   * أول ساعة قابلة للتعيين لفني بعينه داخل أفق الحجز. إعادة الضمان تستخدمها بدل إضافة عدد
   * ثابت من الأيام؛ ونفس شرط الأهلية/التعارض المستخدم في المطابقة هو الذي يحكم النتيجة هنا.
   * الاستعلام يفحص الأفق كله مرة واحدة حتى لا يتحول أسبوع مزدحم إلى مئات الاستعلامات المتتالية.
   */
  async findFirstAvailableStartForTechnician(
    technicianId: string,
    serviceId: string,
    zoneId: string,
    addressId: string,
    notBefore: Date,
    maxDays = 90,
    candidateLoad?: CandidateOperationalLoad,
  ): Promise<Date | null> {
    const [dailyCapacityMinutes, dayStartHour, dayEndHour] = await Promise.all([
      resolveDailyCapacityMinutes(this.settingsService),
      this.settingsService.getNumber('booking.suggestion_day_start_hour', 9),
      this.settingsService.getNumber('booking.suggestion_day_end_hour', 19),
    ]);
    const startHour = Math.max(0, Math.min(23, Math.round(dayStartHour)));
    const endHour = Math.max(startHour, Math.min(23, Math.round(dayEndHour)));
    const horizonDays = Math.max(1, Math.min(365, Math.round(maxDays)));

    const rows = await this.technicianProfiles.manager.query<{ starts_at: Date }[]>(
      `
      WITH candidate_starts AS (
        SELECT ((day::date + make_interval(hours => hour_of_day)) AT TIME ZONE 'Africa/Cairo') AS starts_at
        FROM generate_series(
          ($5::timestamptz AT TIME ZONE 'Africa/Cairo')::date,
          ($5::timestamptz AT TIME ZONE 'Africa/Cairo')::date + make_interval(days => $6::int),
          interval '1 day'
        ) day
        CROSS JOIN generate_series($7::int, $8::int) hour_of_day
      )
      SELECT c.starts_at
      FROM candidate_starts c
      JOIN technician_profiles tp ON tp.id = $4
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1
        AND ts.is_active = true AND ts.verification_status = 'approved'
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN services svc ON svc.id = $1
      CROSS JOIN (SELECT location FROM addresses WHERE id = $3) a
      WHERE c.starts_at > $5::timestamptz
        AND tp.verification_status = 'approved' AND tp.deleted_at IS NULL
        AND tp.current_location IS NOT NULL
        AND ${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 'svc.id',
          categoryIdExpr: 'svc.category_id',
          directServiceAlias: 'ts',
        })}
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: 'c.starts_at',
          excludeOrderIdParam: 'NULL',
          activeStatusesParam: '$9',
          engagedStatusesParam: '$10',
          isEmergencyParam: '$11',
          serviceDurationExpr: 'COALESCE($13::int, COALESCE(svc.estimated_duration_minutes, 60))',
          candidateLoad: {
            estimatedDurationDaysExpr: '$14::numeric',
            durationMinutesExpr: '$13::int',
            serviceDefaultMinutesExpr: 'svc.estimated_duration_minutes',
          },
          preciseDurationHoursExpr: '$13::numeric / 60.0',
          dailyCapacityMinutesParam: '$12',
        })}
      ORDER BY c.starts_at ASC
      LIMIT 1
      `,
      [
        serviceId,
        zoneId,
        addressId,
        technicianId,
        notBefore,
        horizonDays,
        startHour,
        endHour,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        false,
        dailyCapacityMinutes,
        candidateLoad?.durationMinutes ?? null,
        candidateLoad?.estimatedDurationDays ?? null,
      ],
    );
    return rows[0]?.starts_at ? new Date(rows[0].starts_at) : null;
  }

  /**
   * "متاح تاني إمتى؟" (ADR-0030) — بتلف يوم بيوم (لحد `maxDays`) بعد `fromDate` لحد ما تلاقي أول
   * يوم الفني بعينه فيه مؤهّل ومتاح فعليًا، بإعادة استخدام `hasEligibleTechnicianForDate()` نفسها
   * (نفس نمط "مرن — اختار نطاق أيام" A.2، بس لفني واحد محدد بدل "أي فني"). `null` لو محدش لقى
   * حل جوّه `maxDays` (الفني مشغول لفترة طويلة جدًا، أو بيانات مفقودة).
   */
  async findNextAvailableDateForTechnician(
    technicianId: string,
    serviceId: string,
    zoneId: string,
    addressId: string,
    fromDate: Date,
    maxDays = 30,
    candidateLoad?: CandidateOperationalLoad,
  ): Promise<string | null> {
    // **بَقّة حقيقية اتصلحت (ADR-0059 §6، بلاغ مالك: «الاقتراح ده مش شغال بكفاءة، هو أصلًا
    // بيجيبنا في اليوم بتاع النهاردة»)**: النسخة القديمة كانت بتبني اليوم المرشّح بجمع 24 ساعة
    // على `fromDate` وتقراه بـ`toISOString().slice(0, 10)` — **يوم UTC**. منتصف الليل بتوقيت
    // القاهرة = 21:00 أو 22:00 UTC اليوم اللي قبله، فالنتيجة كانت بترجّع **نفس اليوم المصري**
    // اللي العميل رافضه أصلاً، والحارس اللي بعدها (`nextAvailable === dateOnly`) يبلعها فيختفي
    // الزرار. دلوقتي التقويم كله بتوقيت القاهرة عبر نفس دوال ADR-0050 اللي التسعير بيستخدمها.
    for (const candidateDayString of cairoDaySequence(cairoDayString(fromDate), maxDays + 1)) {
       
      const eligible = await this.hasEligibleTechnicianForDate(
        serviceId,
        zoneId,
        addressId,
        // منتصف الليل المصري لليوم المرشّح — مش «نفس ساعة الحجز بعد N يوم»، اللي كان ممكن
        // يزحلق اليوم عند تغيير التوقيت الصيفي.
        cairoMidnight(candidateDayString),
        technicianId,
        undefined,
        candidateLoad,
      );
      if (eligible) return candidateDayString;
    }
    return null;
  }

  /**
   * بروفايل عام — للعميل يشوفه قبل/بعد الحجز. معدل الالتزام بالمواعيد (`on_time_rate`) بيتحسب
   * بس من الطلبات اللي عندها `scheduled_at` فعلي (فرق عن ASAP اللي معندهاش وقت متوقّع يتقاس
   * عليه الالتزام أصلاً) — `null` لو مفيش طلبات مجدولة اتنفّذت لسه، مش صفر مضلّل.
   */
  async getPublicProfile(technicianProfileId: string): Promise<{
    profile: TechnicianProfile;
    fullName: string;
    avatarUrl: string | null;
    avatarStorageKey: string | null;
    zones: { id: string; nameAr: string }[];
    services: { id: string; nameAr: string; basePriceCents: number }[];
    recentReviews: { overallRating: number; comment: string | null; createdAt: Date }[];
    onTimeRate: number | null;
    portfolioLinks: TechnicianPortfolioLink[];
    certificates: TechnicianCertificate[];
  }> {
    const profile = await this.findByProfileIdOrThrow(technicianProfileId);

    interface UserRow {
      full_name: string;
      avatar_url: string | null;
      avatar_storage_key: string | null;
    }
    const [user] = await this.technicianProfiles.manager.query<UserRow[]>(
      `SELECT full_name, avatar_url, avatar_storage_key FROM users u JOIN technician_profiles tp ON tp.user_id = u.id WHERE tp.id = $1`,
      [technicianProfileId],
    );
    // **صف مستخدم ناقص = انهيار غير مفهوم عند العميل.** `user.full_name` على `undefined` بترمي
    // `TypeError` — واللي بيوصل للعميل هو «حصل خطأ غير متوقع، حاول تاني» من فلتر الاستثناءات
    // العام، بلا أي إشارة للفني اللي سبب المشكلة. الرمي الصريح هنا بيخلّي السبب مكتوب في
    // الرسالة واللوج، وبيحوّل العطل من «مجهول» لـ«بيانات ناقصة لفني بعينه».
    if (!user) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'بيانات الفني ده ناقصة (مفيش حساب مستخدم مربوط) — تواصل مع الدعم',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    interface ZoneRow {
      id: string;
      name_ar: string;
    }
    const zones = await this.technicianProfiles.manager.query<ZoneRow[]>(
      `SELECT sz.id, sz.name_ar FROM technician_zones tz
       JOIN service_zones sz ON sz.id = tz.service_zone_id
       WHERE tz.technician_id = $1 AND tz.is_active = true AND tz.deleted_at IS NULL
       ORDER BY tz.is_primary DESC, sz.name_ar ASC`,
      [technicianProfileId],
    );

    interface ServiceRow {
      id: string;
      name_ar: string;
      base_price_cents: number;
    }
    const services = await this.technicianProfiles.manager.query<ServiceRow[]>(
      `SELECT s.id, s.name_ar, s.base_price_cents FROM technician_services ts
       JOIN services s ON s.id = ts.service_id
       WHERE ts.technician_id = $1 AND ts.is_active = true AND s.is_active = true
       ORDER BY s.name_ar ASC`,
      [technicianProfileId],
    );

    interface ReviewRow {
      overall_rating: number;
      comment: string | null;
      created_at: Date;
    }
    const recentReviews = await this.technicianProfiles.manager.query<ReviewRow[]>(
      `SELECT r.overall_rating, r.comment, r.created_at FROM ratings r
       WHERE r.rated_user_id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true
       ORDER BY r.created_at DESC LIMIT 5`,
      [profile.userId],
    );

    interface OnTimeRow {
      on_time: string;
      total: string;
    }
    const [onTimeRow] = await this.technicianProfiles.manager.query<OnTimeRow[]>(
      `SELECT
         COUNT(*) FILTER (WHERE technician_arrived_at <= scheduled_at + interval '15 minutes') AS on_time,
         COUNT(*) AS total
       FROM orders
       WHERE technician_id = $1 AND scheduled_at IS NOT NULL AND technician_arrived_at IS NOT NULL AND deleted_at IS NULL`,
      [technicianProfileId],
    );
    const onTimeTotal = Number(onTimeRow.total);
    const onTimeRate = onTimeTotal > 0 ? Math.round((Number(onTimeRow.on_time) / onTimeTotal) * 100) : null;

    const portfolioLinks = await this.portfolioLinksService.listForTechnician(technicianProfileId);
    const certificates = await this.certificatesService.listApprovedForTechnician(technicianProfileId);

    return {
      profile,
      fullName: user.full_name,
      avatarUrl: user.avatar_url,
      avatarStorageKey: user.avatar_storage_key,
      zones: zones.map((z) => ({ id: z.id, nameAr: z.name_ar })),
      services: services.map((s) => ({ id: s.id, nameAr: s.name_ar, basePriceCents: s.base_price_cents })),
      portfolioLinks,
      recentReviews: recentReviews.map((r) => ({
        overallRating: r.overall_rating,
        comment: r.comment,
        createdAt: r.created_at,
      })),
      onTimeRate,
      certificates,
    };
  }

  async updateLocation(userId: string, dto: UpdateLocationDto): Promise<void> {
    const profile = await this.findByUserIdOrThrow(userId);
    profile.currentLocation = { type: 'Point', coordinates: [dto.longitude, dto.latitude] };
    await this.technicianProfiles.update(profile.id, {
      currentLocation: profile.currentLocation,
      currentLocationUpdatedAt: new Date(),
    });
  }
}
