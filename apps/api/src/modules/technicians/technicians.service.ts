import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import {
  TechnicianAssistantLinkStatus,
  TechnicianProfile,
  TechnicianTeamRole,
} from './entities/technician-profile.entity';
import { TechnicianCompany } from './entities/technician-company.entity';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { TechnicianPortfolioLink } from './entities/technician-portfolio-link.entity';
import { PortfolioLinksService } from './portfolio-links.service';

// تصنيف نوع الفني الأربعة (docs/06 §3.8) — دالة على بيانات موجودة بالفعل، مش مفهوم جديد.
// "فريق"/"شركة" (technician_companies, migration 0026) الفرق الوحيد بينهم commercial_registration_number
// (موجود=شركة، فاضي=فريق) — قرار سابق موثّق في technicians/README.md، مش اختراع جديد هنا.
export type TechnicianType = 'individual' | 'individual_with_assistant' | 'team' | 'company';

@Injectable()
export class TechniciansService {
  constructor(
    @InjectRepository(TechnicianProfile) private readonly technicianProfiles: Repository<TechnicianProfile>,
    @InjectRepository(TechnicianCompany) private readonly technicianCompanies: Repository<TechnicianCompany>,
    private readonly portfolioLinksService: PortfolioLinksService,
    private readonly auditLog: AuditLogService,
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
    portfolioLinks: TechnicianPortfolioLink[];
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
       WHERE technician_id = $1 AND scheduled_at IS NOT NULL AND technician_arrived_at IS NOT NULL`,
      [technicianProfileId],
    );
    const onTimeTotal = Number(onTimeRow.total);
    const onTimeRate = onTimeTotal > 0 ? Math.round((Number(onTimeRow.on_time) / onTimeTotal) * 100) : null;

    const portfolioLinks = await this.portfolioLinksService.listForTechnician(technicianProfileId);

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
