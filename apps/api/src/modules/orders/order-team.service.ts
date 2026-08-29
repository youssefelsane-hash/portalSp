import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_CREW_CHANGED_EVENT, OrderCrewChangedEvent } from '../../common/events/order-crew-changed.event';
import { WORK_OPPORTUNITY_OFFERED_EVENT, WorkOpportunityOfferedEvent } from '../../common/events/work-opportunity-offered.event';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import {
  TechnicianCapacityTier,
  classifyTechnicianCapacity,
  technicianKindCondition,
  technicianServiceQualificationCondition,
} from '../technicians/technician-eligibility.sql';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { SettingsService } from '../settings/settings.service';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { resolveEffectiveMemberType } from './crew-member-type';
import { OrderTeamMemberRow } from './dto/team-member-response.dto';
import { BookingMode, Order } from './entities/order.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';

export const MAX_TEAM_MEMBERS_PER_ORDER = 15;

// ADR-0052 (docs/08 §97) — «مساعد واحد فقط» بنص المالك، بس كإعداد مش رقم مكتوب في الكود.
export const OPTIONAL_ASSISTANT_ENABLED_SETTING = 'crew.optional_assistant_enabled';
export const OPTIONAL_ASSISTANT_MAX_SETTING = 'crew.optional_assistant_max_per_order';
export const OPTIONAL_ASSISTANT_MAX_FALLBACK = 1;
const FULL_DAY_JOB_MINUTES_FALLBACK = 360;

export type CrewRole = 'technician' | 'assistant';

// ترتيب رتبة الفني (docs/08 §31) — نفس ترتيب تعريف enum TechnicianLevel التصريحي بالحرف، قرار
// مقصود للبساطة (طلب المالك صراحة) بدل الاعتماد على order_priority_weight القابل للتعديل في
// technician_level_config (كان هيحتاج join إضافي بلا داعي حقيقي هنا).
const TECHNICIAN_LEVEL_RANK: Record<TechnicianLevel, number> = {
  [TechnicianLevel.NEW]: 0,
  [TechnicianLevel.VERIFIED]: 1,
  [TechnicianLevel.PROFESSIONAL]: 2,
  [TechnicianLevel.PREMIUM]: 3,
  [TechnicianLevel.TEAM_LEADER]: 4,
};

export interface RecruitCandidateRow {
  technicianId: string;
  fullName: string;
  avatarUrl: string | null;
  currentLevel: TechnicianLevel;
  averageRating: string;
  distanceKm: string | null;
  isLeaderTeamMember: boolean;
  isPreferredCrewMember: boolean;
  capacityTier: TechnicianCapacityTier;
}

export interface CrewComposition {
  requiredTechnicians: number;
  requiredAssistants: number;
  /** بما فيهم القائد (+1 دايمًا). */
  assignedTechnicians: number;
  assignedAssistants: number;
  missingTechnicians: number;
  missingAssistants: number;
  crewComplete: boolean;
  // ADR-0052 (docs/08 §97) — المساعد الاختياري للشغلانة الفردية. **منفصل تمامًا عن حقول النقص
  // فوق عن قصد**: الاختياري عمره ما يبقى "نقص" (مفيش تصعيد، مفيش كارت أحمر، مفيش بند استثناءات).
  /** عدد المساعدين الاختياريين المضافين فعلاً. */
  optionalAssistantsAdded: number;
  /** كام مساعد اختياري لسه مسموح يضيفه دلوقتي — صفر لطلبات الفريق ولأي طلب مش فردي. */
  optionalAssistantSlots: number;
}

export type RecruitOutcome =
  | { status: 'added' }
  | { status: 'offer_sent'; opportunityId: string; capacityTier: TechnicianCapacityTier };

/**
 * علامة داخلية بس (docs/08 §35.19) — بَقّة حقيقية اتلقطت وقت كتابة اختبار التزامن: acceptCrewOpportunity()
 * كانت بتعمل markDecided(..., 'declined') **جوّه** نفس المعاملة اللي هترمي استثناء وترتد (rollback)
 * — يعني تعليم الفرصة declined كان بيتلغى تلقائيًا مع باقي المعاملة، فالفرصة كانت تفضل offered
 * للأبد رغم إن الطلب اتحسم لصالح حد تاني. الحل: نرمي العلامة دي بدل ApiException مباشرة، نمسك بره
 * المعاملة (بعد الـrollback)، نسجّل declined بكتابة منفصلة (خارج المعاملة الملغاة)، وبعدين نرمي
 * الخطأ الحقيقي للمستخدم.
 */
class CrewOpportunityDeclinedError extends Error {
  constructor(public readonly apiError: ApiException) {
    super(apiError.message);
  }
}

/**
 * تكوين الطاقم (docs/08 §35، ADR-0021 §1) — مصدر الحقيقة الوحيد لسؤال "الطاقم كامل؟"، فني/مساعد
 * منفصلين. بتستبدل computeCrewShortage() القديمة اللي كانت بتتجاهل required_assistants تمامًا
 * وبتحسب فني/مساعد كواحد — بَقّة حقيقية اتلقطت في مراجعة §35.0 (راجع ADR-0021 للسياق الكامل).
 * الـ+1 في assignedTechnicians بيمثّل قائد الطلب نفسه (مش صف في order_team_members).
 */
/**
 * ADR-0052 (docs/08 §97) — "شغلانة فردية" = محتاجة شخص واحد بس. الأهلية **مشتقّة** من متطلبات
 * الطلب نفسها، مش عمود جديد: عمود منفصل كان هيبقى مصدر حقيقة تاني لنفس السؤال لازم يتزامن يدويًا
 * مع `required_technicians`، وأول ما يختلفوا الاتنين يبقوا غلط.
 */
export function isSoloJob(order: Pick<Order, 'requiredTechnicians' | 'requiredAssistants'>): boolean {
  return (order.requiredTechnicians ?? 1) <= 1 && (order.requiredAssistants ?? 0) === 0;
}

/** كام خانة مساعد اختياري لسه مفتوحة. صفر لأي طلب مش فردي، أو لو الميزة متقفلة من الإعدادات. */
export function computeOptionalAssistantSlots(
  order: Pick<Order, 'requiredTechnicians' | 'requiredAssistants'>,
  assistantsAdded: number,
  opts: { enabled: boolean; maxPerOrder: number },
): number {
  if (!opts.enabled || !isSoloJob(order)) return 0;
  return Math.max(0, Math.floor(opts.maxPerOrder) - assistantsAdded);
}

export function computeCrewComposition(
  requiredTechnicians: number | null,
  requiredAssistants: number | null,
  counts: { technicians: number; assistants: number },
  optionalAssistantSlots = 0,
): CrewComposition {
  const reqTechnicians = requiredTechnicians ?? 1;
  const reqAssistants = requiredAssistants ?? 0;
  const assignedTechnicians = counts.technicians + 1;
  const assignedAssistants = counts.assistants;
  const missingTechnicians = Math.max(0, reqTechnicians - assignedTechnicians);
  const missingAssistants = Math.max(0, reqAssistants - assignedAssistants);
  return {
    requiredTechnicians: reqTechnicians,
    requiredAssistants: reqAssistants,
    assignedTechnicians,
    assignedAssistants,
    missingTechnicians,
    missingAssistants,
    crewComplete: missingTechnicians === 0 && missingAssistants === 0,
    optionalAssistantsAdded: assignedAssistants,
    optionalAssistantSlots,
  };
}

/**
 * توزيع أدوار الفريق داخل الطلب الواحد (docs/08 §5) — إضافي بحت فوق orders.technician_id
 * ("قائد الطلب"، بيفضل زي ما هو من غير أي تغيير). مين يقدر يضيف؟ الفني المسؤول عن الطلب
 * (orders.technician_id) بس، وبس لأعضاء من **نفس الشركة/الفريق** (company_id مطابق) — عشان
 * منمنعش فني يحط أي حد عشوائي على طلب مش بتاعه. مقصود إن العضو المضاف مبيوافقش على الإضافة —
 * زي "معاه مساعد؟" (technicians/README.md) بالظبط، القرار للفني القائد مش للمضاف.
 *
 * **docs/08 §35، ADR-0021** — التجنيد الأوسع (listRecruitCandidates/recruitMember) بقى بيعيد
 * استخدام نفس دوال الأهلية/القدرة الحقيقية (technicianAvailabilityCondition/classifyTechnicianCapacity)
 * بدل قاعدة isAvailable القديمة اللي اتشالت من الأهلية بالكامل من ADR-0017 — كانت بَقّة انجراف
 * حقيقية (تجنيد الفريق شغال بقاعدة مختلفة عن باقي المنصة). راجع ADR-0021 §2 للتفاصيل الكاملة.
 */
@Injectable()
export class OrderTeamService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderTeamMember) private readonly teamMembers: Repository<OrderTeamMember>,
    private readonly techniciansService: TechniciansService,
    private readonly assignmentGuard: TechnicianAssignmentGuardService,
    private readonly workOpportunities: TechnicianWorkOpportunitiesService,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  private async findOwnedOrderOrThrow(userId: string, orderId: string): Promise<{ order: Order; leaderProfileId: string }> {
    const leaderProfile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: leaderProfile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return { order, leaderProfileId: leaderProfile.id };
  }

  async addMember(userId: string, orderId: string, dto: AddTeamMemberDto): Promise<void> {
    const { order, leaderProfileId } = await this.findOwnedOrderOrThrow(userId, orderId);

    if (order.bookingMode !== BookingMode.TEAM) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'توزيع أعضاء الفريق متاح بس للطلبات اللي حجزها "اعتماد" (فريق)',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.technician_id === leaderProfileId) {
      throw new ApiException(ErrorCode.VAL_001, 'أنت أصلاً المسؤول عن الطلب ده', HttpStatus.BAD_REQUEST);
    }

    const leaderProfile = await this.techniciansService.findByProfileIdOrThrow(leaderProfileId);
    const memberProfile = await this.techniciansService.findByProfileIdOrThrow(dto.technician_id);
    if (!leaderProfile.companyId || memberProfile.companyId !== leaderProfile.companyId) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مش في نفس فريقك/شركتك', HttpStatus.BAD_REQUEST);
    }

    const existingCount = await this.teamMembers.count({ where: { orderId } });
    if (existingCount >= MAX_TEAM_MEMBERS_PER_ORDER) {
      throw new ApiException(ErrorCode.VAL_001, `أقصى عدد أعضاء فريق للطلب هو ${MAX_TEAM_MEMBERS_PER_ORDER}`, HttpStatus.BAD_REQUEST);
    }
    const alreadyAdded = await this.teamMembers.findOne({ where: { orderId, technicianId: dto.technician_id } });
    if (alreadyAdded) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مضاف بالفعل لفريق الطلب ده', HttpStatus.CONFLICT);
    }

    const member = this.teamMembers.create({
      orderId,
      technicianId: dto.technician_id,
      roleLabel: dto.role_label,
      addedByTechnicianId: leaderProfileId,
      // ADR-0050 — المسار القديم ده مكانش بيحدد memberType خالص (كان بيعتمد على default الجدول
      // 'team_member')، يعني مساعد مضاف من هنا كان بياخد نصيب عضو فريق كامل. الفرض هنا بيقفل
      // الثغرة دي من غير ما يغيّر سلوك الفنيين العاديين.
      memberType: resolveEffectiveMemberType('team_member', memberProfile.technicianKind),
    });
    await this.teamMembers.save(member);
  }

  async removeMember(userId: string, orderId: string, memberId: string): Promise<void> {
    await this.findOwnedOrderOrThrow(userId, orderId);
    const member = await this.teamMembers.findOne({ where: { id: memberId, orderId } });
    if (!member) {
      throw new ApiException(ErrorCode.VAL_001, 'عضو الفريق ده غير موجود', HttpStatus.NOT_FOUND);
    }
    await this.teamMembers.remove(member);
  }

  /** عام عمداً (بدون فحص ملكية) — بيتنادى من واجهة الفني (القائد) والعميل والأدمن كلهم لعرض نفس القايمة. */
  // docs/08 §35.16 (كارت رؤية طاقم الطلب للأدمن) — "مين ضاف مين وإمتى". added_by بيتحل لاسم حقيقي
  // (مش UUID خام) عبر LEFT JOIN منفصل لكل مصدر ممكن (تقني القائد أو أدمن)، بلا تكرار منطق حل
  // الاسم في التطبيق. الأعمدة الخام (addedByTechnicianId/addedByAdminUserId) كانت موجودة أصلاً في
  // order_team_members من الإضافة الأولى (§35.1-3/§35.6) — صفر migration جديدة، بس أول استهلاك
  // فعلي ليها هنا.
  async listForOrder(orderId: string): Promise<OrderTeamMemberRow[]> {
    const rows = await this.teamMembers.manager.query<
      {
        id: string;
        technicianId: string;
        fullName: string;
        avatarUrl: string | null;
        roleLabel: string;
        memberType: string;
        createdAt: Date;
        addedByType: 'leader' | 'admin' | null;
        addedByName: string | null;
      }[]
    >(
      `SELECT otm.id, otm.technician_id AS "technicianId", u.full_name AS "fullName", u.avatar_url AS "avatarUrl",
              otm.role_label AS "roleLabel", otm.member_type AS "memberType", otm.created_at AS "createdAt",
              CASE WHEN otm.added_by_technician_id IS NOT NULL THEN 'leader'
                   WHEN otm.added_by_admin_user_id IS NOT NULL THEN 'admin'
                   ELSE NULL END AS "addedByType",
              COALESCE(leader_user.full_name, admin_user.full_name) AS "addedByName"
       FROM order_team_members otm
       JOIN technician_profiles tp ON tp.id = otm.technician_id
       JOIN users u ON u.id = tp.user_id
       LEFT JOIN technician_profiles leader_profile ON leader_profile.id = otm.added_by_technician_id
       LEFT JOIN users leader_user ON leader_user.id = leader_profile.user_id
       LEFT JOIN users admin_user ON admin_user.id = otm.added_by_admin_user_id
       WHERE otm.order_id = $1
       ORDER BY otm.created_at ASC`,
      [orderId],
    );
    return rows.map((r) => ({
      id: r.id,
      technicianId: r.technicianId,
      fullName: r.fullName,
      avatarUrl: r.avatarUrl,
      roleLabel: r.roleLabel,
      memberType: r.memberType,
      createdAt: r.createdAt,
      addedBy: r.addedByType && r.addedByName ? { type: r.addedByType, name: r.addedByName } : null,
    }));
  }

  /**
   * "الطاقم كامل؟" (docs/08 §35، ADR-0021 §1) — مصدر الحقيقة الوحيد، فني/مساعد منفصلين. بتُستخدم
   * من الفني القائد، الأدمن، وبوابة اكتمال الطاقم في OrdersService.start() — نفس الحساب بالظبط
   * في كل مكان.
   */
  async getCrewComposition(orderId: string, order: Pick<Order, 'requiredTechnicians' | 'requiredAssistants'>): Promise<CrewComposition> {
    const rows = await this.teamMembers.manager.query<{ member_type: string; count: string }[]>(
      `SELECT member_type, COUNT(*) AS count FROM order_team_members WHERE order_id = $1 GROUP BY member_type`,
      [orderId],
    );
    const technicians = Number(rows.find((r) => r.member_type === 'team_member')?.count ?? 0);
    const assistants = Number(rows.find((r) => r.member_type === 'assistant')?.count ?? 0);
    // الشغلانة اللي مش فردية عمرها ما ياخد خانة اختيارية، فمفيش أي داعي نسأل الإعدادات أصلاً —
    // `getCrewComposition()` بتتنادى في مسارات متكررة (مسح التصعيد الدوري) فالنداء المتوفّر مقصود.
    const optionalAssistantSlots = isSoloJob(order)
      ? computeOptionalAssistantSlots(order, assistants, await this.optionalAssistantPolicy())
      : 0;
    return computeCrewComposition(order.requiredTechnicians, order.requiredAssistants, { technicians, assistants }, optionalAssistantSlots);
  }

  /** إعدادات المساعد الاختياري (ADR-0052) — قفل عام + حد أقصى، الاتنين قابلين للتعديل بلا كود. */
  private async optionalAssistantPolicy(): Promise<{ enabled: boolean; maxPerOrder: number }> {
    const [enabled, maxPerOrder] = await Promise.all([
      this.settingsService.getBoolean(OPTIONAL_ASSISTANT_ENABLED_SETTING, true),
      this.settingsService.getNumber(OPTIONAL_ASSISTANT_MAX_SETTING, OPTIONAL_ASSISTANT_MAX_FALLBACK),
    ]);
    return { enabled, maxPerOrder };
  }

  private async getServiceDurationMinutes(order: Order): Promise<number> {
    // docs/01B — مدة الطلب الحقيقية (ADR-0031/0032) بتتقدم على دقائق الخدمة الثابتة
    if (order.durationHours != null && order.durationHours > 0) {
      return order.durationHours * 60;
    }
    const [service] = await this.teamMembers.manager.query<{ estimated_duration_minutes: number | null }[]>(
      `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
      [order.serviceId],
    );
    return service?.estimated_duration_minutes ?? 60;
  }

  /**
   * مرشّحين للتجنيد الذاتي (docs/08 §31/§35، ADR-0021 §2) — نفس نمط TechniciansService
   * .listForServiceBooking() بالحرف (نفس الجداول/شرط الأهلية بالفئة، ADR-0018 §8)، لكن **بدون**
   * استبعاد الفنيين المثقلين (MEANINGFUL/HEAVY) من القايمة — بيترجعوا مع تصنيف قدرتهم
   * (`capacityTier`) عشان الواجهة تقدر تعرض "فرصة اختيارية" بدل تجنيد فوري. البلوك المستبعد
   * الوحيد هو BLOCKED (حظر يوم صريح) — ده استبعاد حقيقي، مش تفضيلي.
   *
   * **أولوية فريق القائد الدائم (docs/08 §35 بند 2، ADR-0021 §2)**: `isLeaderTeamMember` (نفس
   * `technician_companies.id` بتاع القائد) بيترتّب أولاً — أعضاء فريقه الدائم بيظهروا فوق أي فني
   * تاني لو مؤهّلين، من غير ما نستبعد الباقي.
   *
   * **أولوية الفريق المفضّل (docs/08 §36.17، ADR-0022)**: `isPreferredCrewMember` (عضو مقبول في
   * الفريق المفضّل الدائم بتاع القائد) بيترتّب تاني حاجة بعد `isLeaderTeamMember` مباشرة — مستوى
   * أولوية إضافي، صفر تأثير على الاستبعاد (فني غير مؤهّل لسه بيتستبعد حتى لو في الفريق المفضّل).
   *
   * ملاحظة أداء: تصنيف القدرة (`classifyTechnicianCapacity`) بيتحسب لكل مرشّح على حدة (N استعلام
   * بعد LIMIT 30) بدل تكرار منطق الـCTE المعقّد بتاعها inline هنا — إعادة استخدام الدالة الواحدة
   * (ADR-0021 §5: "صفر مصدر حقيقة تاني") أهم من توفير استعلام واحد في مسار مش ساخن (يتنادى من
   * القائد وقت التجنيد بس، مش في كل دورة مطابقة).
   */
  async listRecruitCandidates(userId: string, orderId: string, role: CrewRole): Promise<RecruitCandidateRow[]> {
    const { order, leaderProfileId } = await this.findOwnedOrderOrThrow(userId, orderId);
    await this.assertCrewSlotOpen(orderId, order, role);

    const leaderProfile = await this.techniciansService.findByProfileIdOrThrow(leaderProfileId);
    const leaderRank = TECHNICIAN_LEVEL_RANK[leaderProfile.currentLevel];

    const rows = await this.teamMembers.manager.query<Omit<RecruitCandidateRow, 'capacityTier'>[]>(
      `
      SELECT tp.id AS "technicianId", u.full_name AS "fullName", u.avatar_url AS "avatarUrl",
             tp.current_level AS "currentLevel", tp.average_rating AS "averageRating",
             ST_Distance(tp.current_location, a.location) / 1000.0 AS "distanceKm",
             (tp.company_id IS NOT NULL AND tp.company_id = $4::uuid) AS "isLeaderTeamMember",
             EXISTS (
               SELECT 1 FROM technician_preferred_crew_members pcm
               WHERE pcm.owner_technician_id = $2 AND pcm.member_technician_id = tp.id
                 AND pcm.status = 'accepted' AND pcm.deleted_at IS NULL
             ) AS "isPreferredCrewMember"
      FROM technician_profiles tp
      JOIN users u ON u.id = tp.user_id
      JOIN orders o ON o.id = $1
      JOIN services svc ON svc.id = o.service_id
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = o.service_id
        AND ts.is_active = true AND ts.verification_status = 'approved'
      CROSS JOIN LATERAL (SELECT location FROM addresses WHERE id = o.address_id) a
      WHERE tp.verification_status = 'approved' AND tp.deleted_at IS NULL
        AND tp.current_location IS NOT NULL
        AND tp.id != $2
        -- ADR-0050 — **النقطة المحورية للفصل**: قبل كده الاستعلام ده كان بيرجّع نفس الناس بالحرف
        -- سواء القائد بيضم "فني" أو "مساعد" (المعامل role كان بيأثر بس على فحص "الخانة اتملت؟").
        -- دلوقتي القايمة بتختلف فعليًا حسب الدور المطلوب — طلب مالك صريح: "أدوس إضافة فني، أقلي
        -- الفنيين... أدخل أضيف مساعدين، أقلي المساعدين بس اللي هم محطوط لهم إن هم مساعدين".
        AND ${technicianKindCondition({ technicianAlias: 'tp', kind: role })}
        AND ${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 'svc.id',
          categoryIdExpr: 'svc.category_id',
          directServiceAlias: 'ts',
        })}
        AND NOT EXISTS (SELECT 1 FROM order_team_members otm WHERE otm.order_id = $1 AND otm.technician_id = tp.id)
        AND CASE tp.current_level
              WHEN 'new' THEN 0 WHEN 'verified' THEN 1 WHEN 'professional' THEN 2
              WHEN 'premium' THEN 3 WHEN 'team_leader' THEN 4 END <= $3
      ORDER BY "isLeaderTeamMember" DESC, "isPreferredCrewMember" DESC, "distanceKm" ASC NULLS LAST, tp.average_rating DESC
      LIMIT 30
      `,
      [orderId, leaderProfileId, leaderRank, leaderProfile.companyId],
    );

    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);
    const serviceDurationMinutes = await this.getServiceDurationMinutes(order);
    const withCapacity = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        capacityTier: await classifyTechnicianCapacity(this.teamMembers.manager, {
          technicianId: row.technicianId,
          scheduledAt: order.scheduledAt,
          excludeOrderId: orderId,
          serviceDurationMinutes,
          fullDayThresholdMinutes: fullDayJobMinutes,
        }),
      })),
    );
    return withCapacity.filter((row) => row.capacityTier !== 'BLOCKED');
  }

  /**
   * الحارس الوحيد لسؤال "فيه خانة مفتوحة للدور ده دلوقتي؟" — مشترك بين قايمة المرشّحين والتجنيد
   * الفعلي عشان الاتنين مايفترقوش أبدًا (القايمة تقول "فيه" والتجنيد يقول "مفيش" أو العكس).
   *
   * **ضم فني** لسه محصور في طلبات "اعتماد" (فريق) بالحرف زي ما كان — الشغلانة الفردية مش محتاجة
   * فني تاني بالتعريف، وفتحها كانت هتخلي أي فني يقسّم أرباح أي شغلانة مع فني تاني بلا سقف.
   *
   * **ضم مساعد** بقى ليه مسارين (ADR-0052، docs/08 §97): نقص إجباري في طلب فريق زي ما كان، أو
   * خانة **اختيارية** في شغلانة فردية — «لو هو مش عايز يضيف مساعد خلاص مش مهم» بنص المالك.
   */
  private async assertCrewSlotOpen(orderId: string, order: Order, role: CrewRole): Promise<void> {
    const composition = await this.getCrewComposition(orderId, order);
    if (role === 'technician') {
      if (order.bookingMode !== BookingMode.TEAM) {
        throw new ApiException(ErrorCode.VAL_001, 'ضم فني متاح بس للطلبات اللي حجزها "اعتماد" (فريق)', HttpStatus.BAD_REQUEST);
      }
      if (composition.missingTechnicians <= 0) {
        throw new ApiException(ErrorCode.VAL_001, 'عدد الفنيين المطلوب مكتمل بالفعل', HttpStatus.BAD_REQUEST);
      }
      return;
    }
    if (composition.missingAssistants > 0) return;
    if (composition.optionalAssistantSlots > 0) return;
    throw new ApiException(
      ErrorCode.VAL_001,
      isSoloJob(order)
        ? 'الشغلانة دي بتسمح بمساعد اختياري واحد بس، وهو مضاف بالفعل'
        : 'عدد المساعدين المطلوب مكتمل بالفعل',
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * تجنيد (docs/08 §31/§35، ADR-0021 §2) — بلا موافقة من المُضاف (زي addMember() بالظبط). بيعيد
   * التحقق الكامل تاني وقت الإضافة الفعلية (القايمة اللي المستخدم شافها ممكن تبقى قديمة). القدرة
   * الاستيعابية بتحدد الأثر: LIGHT = إضافة فورية، MEANINGFUL/HEAVY = فرصة اختيارية (technician_
   * work_opportunities، context='crew_recruit') بدل تحميل صامت — نفس فلسفة ADR-0020 بالحرف،
   * تطبيقها هنا بالظبط المطلوب في docs/08 §35 بند 3 ("لا تحميل صامت لعضو فريق مثقل").
   */
  async recruitMember(userId: string, orderId: string, technicianId: string, role: CrewRole, roleLabel?: string): Promise<RecruitOutcome> {
    const { order, leaderProfileId } = await this.findOwnedOrderOrThrow(userId, orderId);
    if (technicianId === leaderProfileId) {
      throw new ApiException(ErrorCode.VAL_001, 'أنت أصلاً المسؤول عن الطلب ده', HttpStatus.BAD_REQUEST);
    }
    await this.assertCrewSlotOpen(orderId, order, role);

    const leaderProfile = await this.techniciansService.findByProfileIdOrThrow(leaderProfileId);
    const candidateProfile = await this.techniciansService.findByProfileIdOrThrow(technicianId);
    if (TECHNICIAN_LEVEL_RANK[candidateProfile.currentLevel] > TECHNICIAN_LEVEL_RANK[leaderProfile.currentLevel]) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده رتبته أعلى منك — مينفعش تجنّده', HttpStatus.FORBIDDEN);
    }
    if (!candidateProfile.currentLocation) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مالوش موقع حالي — مينفعش يتجنّد دلوقتي', HttpStatus.CONFLICT);
    }

    const existingCount = await this.teamMembers.count({ where: { orderId } });
    if (existingCount >= MAX_TEAM_MEMBERS_PER_ORDER) {
      throw new ApiException(ErrorCode.VAL_001, `أقصى عدد أعضاء فريق للطلب هو ${MAX_TEAM_MEMBERS_PER_ORDER}`, HttpStatus.BAD_REQUEST);
    }
    const alreadyAdded = await this.teamMembers.findOne({ where: { orderId, technicianId } });
    if (alreadyAdded) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مضاف بالفعل لفريق الطلب ده', HttpStatus.CONFLICT);
    }

    const fullDayJobMinutes = await this.settingsService.getNumber('matching.full_day_job_minutes', FULL_DAY_JOB_MINUTES_FALLBACK);
    const serviceDurationMinutes = await this.getServiceDurationMinutes(order);
    const tier = await classifyTechnicianCapacity(this.teamMembers.manager, {
      technicianId,
      scheduledAt: order.scheduledAt,
      excludeOrderId: orderId,
      serviceDurationMinutes,
      fullDayThresholdMinutes: fullDayJobMinutes,
    });
    if (tier === 'BLOCKED') {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده حظر اليوم ده بنفسه — مينفعش يتجنّد', HttpStatus.CONFLICT);
    }

    // ADR-0050 — الدور المطلوب بيتفلتر من خلال دور الشخص نفسه: مساعد بالبروفايل بياخد نسبة
    // المساعد دايمًا مهما كان اللي القائد طلبه.
    const memberType = resolveEffectiveMemberType(role === 'assistant' ? 'assistant' : 'team_member', candidateProfile.technicianKind);
    const label = roleLabel && roleLabel.trim().length > 0 ? roleLabel.trim() : memberType === 'assistant' ? 'مساعد' : 'عضو فريق';

    if (tier === 'LIGHT') {
      const member = this.teamMembers.create({ orderId, technicianId, roleLabel: label, addedByTechnicianId: leaderProfileId, memberType });
      await this.teamMembers.save(member);
      this.events.emit(ORDER_CREW_CHANGED_EVENT, new OrderCrewChangedEvent(orderId, 'added', technicianId, null, 'technician'));
      return { status: 'added' };
    }

    // MEANINGFUL/HEAVY — فرصة اختيارية بدل تحميل صامت (docs/08 §35 بند 3).
    const opportunity = await this.workOpportunities.offerIfNotExists(
      this.teamMembers.manager,
      orderId,
      technicianId,
      tier,
      'crew_recruit',
      role,
    );
    // docs/08 §36.1 — إشعار حقيقي بدل ما الفني يعتمد على فتح/تحديث شاشة الطلبات المتاحة بنفسه
    // عشان يكتشف الفرصة. created:false يعني كانت موجودة بالفعل (idempotent re-check)، مفيش داعي
    // إشعار مكرر.
    if (opportunity.created) {
      this.events.emit(
        WORK_OPPORTUNITY_OFFERED_EVENT,
        new WorkOpportunityOfferedEvent(
          opportunity.id,
          orderId,
          order.orderNumber,
          technicianId,
          'crew_recruit',
          tier,
          order.scheduledAt,
        ),
      );
    }
    return { status: 'offer_sent', opportunityId: opportunity.id, capacityTier: tier };
  }

  /**
   * قبول فرصة تجنيد فريق (docs/08 §35، ADR-0021 §2) — إعادة فحص كاملة تحت قفل قبل أي كتابة، نفس
   * فلسفة MatchingService.acceptWorkOpportunity() بالحرف، لكن الأثر مختلف جوهريًا: إضافة صف
   * order_team_members بدل تغيير orders.technician_id (الفرصة دي "انضم كعضو" مش "بقى القائد").
   * إعادة فحص عدد المطلوب المتبقي **تحت قفل** هنا تحديدًا هي حماية التزامن الحقيقية (docs/08 §35
   * سيناريو L — منع تجاوز العدد المطلوب لو أكتر من فرصة اتقبلت بالتوازي).
   */
  async acceptCrewOpportunity(userId: string, opportunityId: string): Promise<OrderTeamMemberRow[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    let orderId: string;
    try {
      // بَقّة حقيقية اتلقطت وقت كتابة اختبار التزامن (docs/08 §35.19): كان listForOrder() بيتنادى
      // *جوّه* المعاملة، بس listForOrder() بيستخدم this.teamMembers.manager (اتصال منفصل مش جزء من
      // المعاملة) — يعني كان بيقرأ قبل الـcommit فعليًا، فمكنش بيشوف صف order_team_members اللي
      // لسه متضاف في نفس المعاملة (Read Committed: الاتصال التاني مايشوفش كتابة معلّقة لسه).
      // الإصلاح: نرجّع orderId بس من جوّه المعاملة، وننادي listForOrder() بعد ما تتقفل (commit) فعليًا.
      orderId = await this.orders.manager.transaction(async (manager) => {
        const opportunity = await this.workOpportunities.getOwnedOfferedOrThrow(manager, profile.id, opportunityId);
        if (opportunity.context !== 'crew_recruit' || !opportunity.crew_role) {
          throw new ApiException(ErrorCode.VAL_001, 'الفرصة دي مش من نوع تجنيد فريق', HttpStatus.BAD_REQUEST);
        }

        const order = await manager
          .createQueryBuilder(Order, 'o')
          .setLock('pessimistic_write')
          .where('o.id = :orderId', { orderId: opportunity.order_id })
          .getOne();
        if (!order || order.bookingMode !== BookingMode.TEAM || !order.technicianId) {
          throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش متاح للتجنيد دلوقتي', HttpStatus.CONFLICT);
        }

        const lockedTechnician = await this.assignmentGuard.lockTechnician(manager, profile.id);
        await this.assignmentGuard.assertEligibleForWorkOpportunity(manager, lockedTechnician, order);

        const composition = await this.getCrewComposition(order.id, order);
        const role = opportunity.crew_role;
        // بَقّة حقيقية تانية اتلقطت وقت كتابة اختبار التزامن (docs/08 §35.19): تعليم الفرصة
        // declined هنا كان بيتعمل بـmarkDecided() *جوّه نفس المعاملة* اللي هترمي استثناء وترتد —
        // يعني التعليم نفسه كان بيتلغى مع الـrollback، والفرصة كانت تفضل offered للأبد رغم إن
        // مكانها راح لحد تاني. لازم نرمي CrewOpportunityDeclinedError بدل ApiException مباشرة،
        // ونمسك بره المعاملة عشان نعلّم declined بكتابة منفصلة *بعد* الـrollback فعليًا.
        if (role === 'technician' && composition.missingTechnicians <= 0) {
          throw new CrewOpportunityDeclinedError(
            new ApiException(ErrorCode.VAL_001, 'عدد الفنيين المطلوب اكتمل قبل ما توصل — الفرصة دي بقت مش متاحة', HttpStatus.CONFLICT),
          );
        }
        if (role === 'assistant' && composition.missingAssistants <= 0) {
          throw new CrewOpportunityDeclinedError(
            new ApiException(ErrorCode.VAL_001, 'عدد المساعدين المطلوب اكتمل قبل ما توصل — الفرصة دي بقت مش متاحة', HttpStatus.CONFLICT),
          );
        }

        const alreadyAdded = await manager.findOne(OrderTeamMember, { where: { orderId: order.id, technicianId: profile.id } });
        if (alreadyAdded) {
          throw new CrewOpportunityDeclinedError(new ApiException(ErrorCode.VAL_001, 'أنت مضاف بالفعل لفريق الطلب ده', HttpStatus.CONFLICT));
        }

        // ADR-0050 — نفس قاعدة الفرض في recruitMember بالحرف.
        const memberType = resolveEffectiveMemberType(role === 'assistant' ? 'assistant' : 'team_member', profile.technicianKind);
        const member = manager.create(OrderTeamMember, {
          orderId: order.id,
          technicianId: profile.id,
          roleLabel: memberType === 'assistant' ? 'مساعد' : 'عضو فريق',
          addedByTechnicianId: order.technicianId,
          memberType,
        });
        await manager.save(member);
        await this.workOpportunities.markDecided(manager, opportunityId, 'accepted');

        this.events.emit(ORDER_CREW_CHANGED_EVENT, new OrderCrewChangedEvent(order.id, 'added', profile.id, null, 'technician'));
        return order.id;
      });
    } catch (err) {
      if (err instanceof CrewOpportunityDeclinedError) {
        await this.workOpportunities.markDecided(this.orders.manager, opportunityId, 'declined');
        throw err.apiError;
      }
      throw err;
    }
    return this.listForOrder(orderId);
  }

  /** فرص تجنيد الفريق المفتوحة للفني الحالي (docs/08 §35، للتطبيق — شاشة منفصلة عن الفرص العادية). */
  async listCrewOpportunitiesForUser(userId: string) {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.workOpportunities.listCrewRecruitForTechnician(profile.id);
  }

  /** رفض فرصة تجنيد فريق — الفني قرر معندوش قدرة استيعابية حقيقية. صفر إعادة توزيع تلقائي (التجنيد قرار القائد/الأدمن، مش دورة مطابقة). */
  async declineCrewOpportunity(userId: string, opportunityId: string): Promise<void> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    await this.orders.manager.transaction(async (manager) => {
      const opportunity = await this.workOpportunities.getOwnedOfferedOrThrow(manager, profile.id, opportunityId);
      if (opportunity.context !== 'crew_recruit') {
        throw new ApiException(ErrorCode.VAL_001, 'الفرصة دي مش من نوع تجنيد فريق', HttpStatus.BAD_REQUEST);
      }
      await this.workOpportunities.markDecided(manager, opportunityId, 'declined');
    });
  }
}
