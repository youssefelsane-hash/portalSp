import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { GeoService } from '../geo/geo.service';
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
import { technicianAvailabilityCondition } from './technician-eligibility.sql';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';

export interface TechnicianBookingListItem {
  technicianId: string;
  fullName: string;
  avatarUrl: string | null;
  bio: string | null;
  averageRating: number;
  totalRatingsCount: number;
  serviceCompletedCount: number;
  distanceKm: number | null;
  // مضاعف سعر مستوى الفني (docs/08) — العميل لازم يشوف رتبة كل فني مرشّح قبل ما يختاره.
  currentLevel: TechnicianLevel;
  // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — مستقلة عن currentLevel، بتتبعت لـestimate()
  // عشان final_price_cents هنا يطابق تمامًا اللي هيتحسب فعليًا وقت الحجز الفعلي.
  pricingTier: TechnicianPricingTier;
  // Script 6 Part 7 — بيانات مقارنة حقيقية للسوق (مفيش بيانات مصطنعة). isVerified دايمًا true
  // هنا فعليًا (المرحلة 1 الصارمة فوق بتفلتر verification_status='approved' بس) — بيترجع
  // كحقل صريح بدل ما apps/customer-app تفترض ده ضمنيًا من مجرد ظهور الفني في القايمة.
  isVerified: boolean;
  onTimeRatePercent: number | null;
  avgArrivalMinutes: number | null;
  // اندماج الشركات في نفس قايمة "اعتماد" (docs/08 §38) — false دايمًا لصفوف الفنيين الأفراد.
  // للشركات: technicianId = technician_companies.id، currentLevel مالوش معنى حقيقي (بيتحط
  // TEAM_LEADER كتمثيل بس، مش مخزّن ولا بيتفحص)، isVerified=true دايمًا (الشركة أصلاً معتمدة
  // بوجود مالك/مدير مستواه premium+ وقت الإنشاء — technician-companies.service.ts).
  isCompany: boolean;
  staffCount: number | null;
  branchCount: number | null;
}

// تصنيف نوع الفني الأربعة (docs/06 §3.8) — دالة على بيانات موجودة بالفعل، مش مفهوم جديد.
// "فريق"/"شركة" (technician_companies, migration 0026) الفرق الوحيد بينهم commercial_registration_number
// (موجود=شركة، فاضي=فريق) — قرار سابق موثّق في technicians/README.md، مش اختراع جديد هنا.
export type TechnicianType = 'individual' | 'individual_with_assistant' | 'team' | 'company';

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
  // هو المسؤول عن فحص شرط الظهور (TECHNICIAN_CONTACT_VISIBLE_STATUSES) قبل ما ينادي الدالة دي أصلاً.
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
    if (dto.bio !== undefined) profile.bio = dto.bio;
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
      existing.skillLevel = dto.skill_level ?? existing.skillLevel;
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
      skillLevel: dto.skill_level,
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
      newValues: { service_id: dto.service_id, skill_level: row.skillLevel },
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
  ): Promise<{ zoneId: string; items: TechnicianBookingListItem[] }> {
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

    const bayesianMinSamples = await this.settingsService.getNumber('ranking.bayesian_min_samples', 5);
    const bayesianPriorMean = await this.settingsService.getNumber('ranking.bayesian_prior_mean', 4.0);
    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', 360);

    interface TechnicianRow {
      technician_id: string;
      full_name: string;
      avatar_url: string | null;
      bio: string | null;
      average_rating: string;
      total_ratings_count: number;
      service_completed_count: number;
      distance_km: string | null;
      current_level: TechnicianLevel;
      pricing_tier: TechnicianPricingTier;
      on_time_rate: string | null;
      avg_arrival_minutes: string | null;
    }
    const rows = await this.technicianProfiles.manager.query<TechnicianRow[]>(
      `
      SELECT tp.id AS technician_id, u.full_name, u.avatar_url, tp.bio,
             tp.average_rating, tp.total_ratings_count, COALESCE(ts.completed_count, 0) AS service_completed_count,
             ST_Distance(tp.current_location, a.location) / 1000.0 AS distance_km, tp.current_level, tp.pricing_tier,
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
             (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (o.technician_arrived_at - o.technician_departed_at)) / 60))
              FROM orders o
              WHERE o.technician_id = tp.id AND o.technician_departed_at IS NOT NULL
                AND o.technician_arrived_at IS NOT NULL AND o.deleted_at IS NULL
             ) AS avg_arrival_minutes
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
      CROSS JOIN (SELECT location FROM addresses WHERE id = $3) a
      WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
        -- ADR-0018 §8 — التأهيل الأساسي: technician_services المباشر (فوق) أو تأهيل بمستوى
        -- الفئة كلها (سباكة/كهرباء/...، technician_categories) — نفس القاعدة اللي matching
        -- .service.ts وassistant-matching.service.ts وtechnician-assignment-guard.service.ts
        -- الثلاثة بيطبّقوها.
        AND (
          ts.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM technician_categories tc
            WHERE tc.technician_id = tp.id AND tc.category_id = svc.category_id
              AND tc.is_active = true AND tc.verification_status = 'approved'
          )
        )
        -- بَقّة حقيقية اتلقطت (بلاغ المالك، 2026-08-19، سيناريو "يوسف") — القايمة دي كانت بترشّح
        -- فني للعرض/الاختيار اليدوي حتى لو معندوش current_location خالص (لسه مفتحش تطبيق الفني
        -- أبدًا)، بينما findEligibleTechnicians() في matching.service.ts (اللي فعليًا بتوزّع
        -- الطلب) بتشترط current_location IS NOT NULL صراحة — يعني عميل يقدر "يختار" فني هنا
        -- والتوزيع الفعلي بعد كده يرفضه تمامًا بصمت. current_location شرط أساسي مايتفاوضش عليه
        -- (لازمة لأي توزيع فعلي بغض النظر عن ASAP/مجدول)، فبقى شرط هنا كمان.
        AND tp.current_location IS NOT NULL
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
          serviceDurationExpr: '(SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1)',
          fullDayThresholdMinutesParam: '$11',
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
        fullDayJobMinutes,
        isTeamBooking,
      ],
    );

    const individualItems: TechnicianBookingListItem[] = rows.map((row) => ({
      technicianId: row.technician_id,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      averageRating: Number(row.average_rating),
      totalRatingsCount: row.total_ratings_count,
      serviceCompletedCount: row.service_completed_count,
      distanceKm: row.distance_km !== null ? Number(row.distance_km) : null,
      currentLevel: row.current_level,
      pricingTier: row.pricing_tier,
      // المرحلة 1 الصارمة فوق فلترت verification_status='approved' بالفعل — أي صف راجع هنا
      // فني موثّق فعلاً، مفيش سبب يبقى false أبداً هنا لكن الحقل بيترجع صريح مش ضمني.
      isVerified: true,
      onTimeRatePercent: row.on_time_rate !== null ? Number(row.on_time_rate) : null,
      avgArrivalMinutes: row.avg_arrival_minutes !== null ? Number(row.avg_arrival_minutes) : null,
      isCompany: false,
      staffCount: null,
      branchCount: null,
    }));

    // اندماج الشركات في نفس قايمة "اعتماد" (docs/08 §38، طلب مالك صريح: "الشركات بتظهر كده كده
    // أساسي في اعتماد، زي شخص عادي جدًا"). individual/emergency (isTeamBooking=false) بلا أي
    // تغيير — الشركة كوحدة حجز مالهاش معنى واضح لـ"فني واحد بيتولى الشغلانة بنفسه" أو التوزيع
    // الفوري. بلا فلتر مستوى هنا عمداً — الشركة أصلاً موثوقة كوحدة (مالكها/مديرها لازم كان
    // premium+ وقت الإنشاء، technician-companies.service.ts's canLeadTeam check)، وطلب المالك
    // كان "الشركات بتظهر كده كده" بلا أي شرط إضافي.
    if (!isTeamBooking) {
      return { zoneId: zone.id, items: individualItems };
    }

    interface CompanyRow {
      company_id: string;
      name: string;
      avg_rating: string | null;
      total_ratings: string | null;
      distance_km: string | null;
      staff_count: string;
      branch_count: string;
    }
    const companyRows = await this.technicianProfiles.manager.query<CompanyRow[]>(
      `
      SELECT tc.id AS company_id, tc.name,
             AVG(tp.average_rating) AS avg_rating,
             SUM(tp.total_ratings_count) AS total_ratings,
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
        AND (
          ts.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM technician_categories catg
            WHERE catg.technician_id = tp.id AND catg.category_id = svc.category_id
              AND catg.is_active = true AND catg.verification_status = 'approved'
          )
        )
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$4',
          excludeOrderIdParam: 'NULL',
          activeStatusesParam: '$5',
          engagedStatusesParam: '$6',
          isEmergencyParam: '$7',
          serviceDurationExpr: '(SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1)',
          fullDayThresholdMinutesParam: '$8',
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
        fullDayJobMinutes,
      ],
    );

    const companyItems: TechnicianBookingListItem[] = companyRows.map((row) => ({
      technicianId: row.company_id,
      fullName: row.name,
      avatarUrl: null,
      bio: null,
      averageRating: row.avg_rating !== null ? Number(row.avg_rating) : 0,
      totalRatingsCount: row.total_ratings !== null ? Number(row.total_ratings) : 0,
      serviceCompletedCount: 0,
      distanceKm: row.distance_km !== null ? Number(row.distance_km) : null,
      // تمثيلي بس (مفيش فني محدد بعد) — أعلى مستوى عشان مايتفسّرش غلط كـ"تحت محترف".
      currentLevel: TechnicianLevel.TEAM_LEADER,
      // تمثيلي بس زي currentLevel فوق — estimate() أصلاً مبيتحسبش للشركات (isCompany:true بترجع
      // estimate:null في catalog.controller.ts)، فالقيمة دي مالهاش أي أثر على السعر المعروض.
      pricingTier: TechnicianPricingTier.STANDARD,
      isVerified: true,
      onTimeRatePercent: null,
      avgArrivalMinutes: null,
      isCompany: true,
      staffCount: Number(row.staff_count),
      branchCount: Number(row.branch_count),
    }));

    // ترتيب موحّد بسيط (تقييم ثم قرب) بعد الدمج — recommendation_score البايزي محسوب بس للفنيين
    // الأفراد (فوق)، فمفيش مقياس واحد موحّد نقدر نستخدمه للاتنين مع بعض غير التقييم/المسافة.
    const merged = [...individualItems, ...companyItems].sort((a, b) => {
      if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
      const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
      const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
      return da - db;
    });

    return { zoneId: zone.id, items: merged };
  }

  /**
   * فحص وجود خفيف (`EXISTS` بس، بلا ترتيب بايزي ولا subqueries إحصائية) — دوس §32.3 docs/08:
   * "مرن — اختار نطاق أيام" في `apps/customer-app` بيحتاج يفحص يوم بيوم داخل نطاق (لحد 14 يوم)
   * عشان يلاقي أقرب يوم فيه فني مؤهّل واحد على الأقل، فلازم استعلام رخيص يتكرر بأمان — نسخة كاملة
   * زي `listForServiceBooking()` (ترتيب توصية بايزي + subqueries التزام بالمواعيد) غالية جدًا
   * تتكرر لحد 14 مرة. نفس شروط الأهلية الأساسية بالحرف (خدمة/فئة، منطقة، `current_location`،
   * `technicianAvailabilityCondition()` الموحّدة).
   */
  async hasEligibleTechnicianForDate(serviceId: string, zoneId: string, addressId: string, date: Date): Promise<boolean> {
    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', 360);
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
          AND (
            ts.id IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM technician_categories tc
              WHERE tc.technician_id = tp.id AND tc.category_id = svc.category_id
                AND tc.is_active = true AND tc.verification_status = 'approved'
            )
          )
          AND tp.current_location IS NOT NULL
          ${technicianAvailabilityCondition({
            technicianIdExpr: 'tp.id',
            scheduledAtParam: '$4',
            excludeOrderIdParam: 'NULL',
            activeStatusesParam: '$5',
            engagedStatusesParam: '$6',
            isEmergencyParam: '$7',
            serviceDurationExpr: '(SELECT COALESCE(estimated_duration_minutes, 60) FROM services WHERE id = $1)',
            fullDayThresholdMinutesParam: '$8',
          })}
      ) AS exists
      `,
      [serviceId, zoneId, addressId, date, ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES, false, fullDayJobMinutes],
    );
    return exists;
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
    zones: { id: string; nameAr: string }[];
    services: { id: string; nameAr: string; basePriceCents: number }[];
    recentReviews: { overallRating: number; comment: string | null; createdAt: Date }[];
    onTimeRate: number | null;
    avgArrivalMinutes: number | null;
    avgCompletionMinutes: number | null;
    portfolioLinks: TechnicianPortfolioLink[];
    certificates: TechnicianCertificate[];
  }> {
    const profile = await this.findByProfileIdOrThrow(technicianProfileId);

    interface UserRow {
      full_name: string;
      avatar_url: string | null;
    }
    const [user] = await this.technicianProfiles.manager.query<UserRow[]>(
      `SELECT full_name, avatar_url FROM users u JOIN technician_profiles tp ON tp.user_id = u.id WHERE tp.id = $1`,
      [technicianProfileId],
    );

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

    // متوسط وقت الوصول = من لحظة ما الفني "طالع للعميل" (technician_departed_at) لحد ما يوصل
    // فعليًا (technician_arrived_at) — مش من وقت القبول، عشان القبول ممكن يبقى قبل الوصول
    // بساعات/أيام في الحجز المسبق، ووقت الرحلة نفسه هو اللي بيعبّر عن "سرعة الوصول" فعلاً.
    interface AvgDurationRow {
      avg_minutes: string | null;
    }
    const [arrivalRow] = await this.technicianProfiles.manager.query<AvgDurationRow[]>(
      `SELECT AVG(EXTRACT(EPOCH FROM (technician_arrived_at - technician_departed_at)) / 60) AS avg_minutes
       FROM orders
       WHERE technician_id = $1 AND technician_departed_at IS NOT NULL AND technician_arrived_at IS NOT NULL AND deleted_at IS NULL`,
      [technicianProfileId],
    );
    const avgArrivalMinutes = arrivalRow.avg_minutes !== null ? Math.round(Number(arrivalRow.avg_minutes)) : null;

    // متوسط مدة إنهاء الخدمة = من بدء التنفيذ الفعلي (work_started_at) لحد الانتهاء (work_completed_at).
    const [completionRow] = await this.technicianProfiles.manager.query<AvgDurationRow[]>(
      `SELECT AVG(EXTRACT(EPOCH FROM (work_completed_at - work_started_at)) / 60) AS avg_minutes
       FROM orders
       WHERE technician_id = $1 AND work_started_at IS NOT NULL AND work_completed_at IS NOT NULL AND deleted_at IS NULL`,
      [technicianProfileId],
    );
    const avgCompletionMinutes = completionRow.avg_minutes !== null ? Math.round(Number(completionRow.avg_minutes)) : null;

    const portfolioLinks = await this.portfolioLinksService.listForTechnician(technicianProfileId);
    const certificates = await this.certificatesService.listApprovedForTechnician(technicianProfileId);

    return {
      profile,
      fullName: user.full_name,
      avatarUrl: user.avatar_url,
      zones: zones.map((z) => ({ id: z.id, nameAr: z.name_ar })),
      services: services.map((s) => ({ id: s.id, nameAr: s.name_ar, basePriceCents: s.base_price_cents })),
      portfolioLinks,
      recentReviews: recentReviews.map((r) => ({
        overallRating: r.overall_rating,
        comment: r.comment,
        createdAt: r.created_at,
      })),
      onTimeRate,
      avgArrivalMinutes,
      avgCompletionMinutes,
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
