import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Between, DataSource, FindOptionsWhere, In, IsNull, LessThanOrEqual, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_REASSIGNED_EVENT, OrderReassignedEvent } from '../../common/events/order-reassigned.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import {
  ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT,
  OrderAssistantAssignedManuallyEvent,
} from '../../common/events/order-assistant-assigned-manually.event';
import { ORDER_CREW_CHANGED_EVENT, OrderCrewChangedEvent } from '../../common/events/order-crew-changed.event';
import { resolveEffectiveMemberType } from './crew-member-type';
import { CrewMemberType } from './dto/admin-crew-member.dto';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechnicianBookingListItem, TechniciansService } from '../technicians/technicians.service';
import {
  TechnicianCapacityTier,
  classifyTechnicianCapacity,
  technicianCityCoverageCondition,
  technicianServiceQualificationCondition,
} from '../technicians/technician-eligibility.sql';
import { SettingsService } from '../settings/settings.service';
import { toOrderResponseDto } from './dto/order-response.dto';
import { TechnicianWorkOpportunitiesService } from '../technicians/technician-work-opportunities.service';
import { WORK_OPPORTUNITY_OFFERED_EVENT, WorkOpportunityOfferedEvent } from '../../common/events/work-opportunity-offered.event';
import { AssignmentStatus, OrderAssignment } from '../matching/entities/order-assignment.entity';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { MAX_TEAM_MEMBERS_PER_ORDER, computeCrewComposition } from './order-team.service';
import { BookingMode, Order, OrderPaymentStatus, OrderStatus, OrderType } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { OrderTimelineEventRow } from './dto/order-timeline-event-response.dto';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { canTransition } from './order-state-machine';
import {
  REVISIT_RESPONSE_WINDOW_HOURS_FALLBACK,
  REVISIT_RESPONSE_WINDOW_HOURS_SETTING,
  loadRevisitPinState,
} from './revisit-pin';
import type { RevisitReleaseReason } from './entities/order.entity';
import { ORDER_REMATCH_REQUESTED_EVENT, OrderRematchRequestedEvent } from '../../common/events/order-rematch-requested.event';
import { WalletsService } from '../payments/wallets.service';
import { WalletTxType } from '../payments/entities/wallet-transaction.entity';
import { PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { EarningsPolicyService } from '../payments/earnings-policy.service';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';
import { resolveDailyCapacityMinutes } from '../technicians/technician-day-capacity.sql';

const ASSISTANT_MEMBER_TYPE = 'assistant';

// حالات مايصحش نعدّل السعر فيها: بعد الدفع (لازم يعدّي من استرداد/تحصيل إضافي حقيقي، مش
// تعديل رقم خام) أو في أي حالة نهائية (اتلغى/انتهت صلاحيته/اتردله فلوسه) — التعديل هنا
// أداة تشغيلية لتصحيح السعر *قبل* التسوية المالية بس.
const PRICE_LOCKED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
  OrderStatus.EXPIRED,
  OrderStatus.REFUNDED,
  OrderStatus.DISPUTED,
]);

// الحالات اللي التعيين اليدوي مسموح فيها — قبل ما أي فني يقبل الطلب. بعد القبول
// (accepted فما بعده) الإلغاء/الاستبدال لازم يعدّي من مسار الشكوى، مش تعيين مباشر،
// مطابق لـ order-state-machine.ts المقفولة (مفيش انتقال accepted→technician_assigned أصلاً).
const REASSIGNABLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.SEARCHING_TECHNICIAN,
  OrderStatus.TECHNICIAN_ASSIGNED,
]);

export function formatEligibleTechniciansForAdmin(result: {
  zoneId: string;
  items: TechnicianBookingListItem[];
}) {
  return {
    ...result,
    // كيان الشركة نفسه يحمل company_id، وليس technician_profile_id، لذلك لا يدخل أي dropdown
    // ينادي reassign/explain. يظهر بدلًا منه ممثلوها الحقيقيون مع اسم الشركة واضحًا.
    items: result.items
      .filter((item) => !item.isCompany)
      .map((item) => ({
        ...item,
        fullName: item.companyName ? `${item.fullName} — ${item.companyName}` : item.fullName,
      })),
  };
}

/**
 * ADR-0057 — نتيجة تعيين طاقم إداري بقت discriminated union بدل `Order` مباشرة: القدرة
 * الاستيعابية MEANINGFUL/HEAVY بقت بتتحول لفرصة تحتاج قبول الشخص نفسه بدل إضافة فورية.
 */
export type CrewAssignOutcome =
  | { status: 'assigned'; order: Order }
  | { status: 'offer_sent'; opportunityId: string; capacityTier: TechnicianCapacityTier };

/** شكل رد API لـ`CrewAssignOutcome` — `order` جزء فقط لو `status='assigned'` (نفس نمط toOrderResponseDto). */
export function toCrewAssignResponseDto(outcome: CrewAssignOutcome) {
  if (outcome.status === 'assigned') {
    return { status: 'assigned' as const, order: toOrderResponseDto(outcome.order) };
  }
  return { status: 'offer_sent' as const, opportunity_id: outcome.opportunityId, capacity_tier: outcome.capacityTier };
}

/** ملخّص طاقم طلب واحد لصفحة القايمة (docs/08 §63.ب5). */
export interface OrderCrewSummary {
  leaderTechnicianId: string | null;
  leaderName: string | null;
  members: { technicianId: string; fullName: string; memberType: 'team_member' | 'assistant' }[];
  /** 0 = مش مطلوب طاقم (طلب فردي). */
  requiredTechnicians: number;
  requiredAssistants: number;
  crewComplete: boolean;
  isTeamBooking: boolean;
}

@Injectable()
export class AdminOrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderStatusHistory) private readonly statusHistory: Repository<OrderStatusHistory>,
    @InjectRepository(TechnicianOrderCancellation)
    private readonly technicianOrderCancellations: Repository<TechnicianOrderCancellation>,
    @InjectRepository(OrderTeamMember) private readonly teamMembers: Repository<OrderTeamMember>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly techniciansService: TechniciansService,
    private readonly assignmentGuard: TechnicianAssignmentGuardService,
    private readonly events: EventEmitter2,
    private readonly auditLog: AuditLogService,
    private readonly pricingEngineService: PricingEngineService,
    private readonly promoCodesService: PromoCodesService,
    private readonly settingsService: SettingsService,
    private readonly walletsService: WalletsService,
    private readonly workOpportunities: TechnicianWorkOpportunitiesService,
    @Optional() private readonly earningsPolicyService?: EarningsPolicyService,
    @Optional() private readonly orderFinancials: OrderFinancialFinalizationService = new OrderFinancialFinalizationService(),
  ) {}

  async list(
    query: ListOrdersQueryDto,
  ): Promise<{ items: Order[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const where: FindOptionsWhere<Order> = {};
    if (query.order_status) where.orderStatus = query.order_status;
    if (query.order_type) where.orderType = query.order_type;
    // فلتر التكرار — IsNull/Not(IsNull) على recurring_template_id (العمود دايمًا زوجي مع
    // recurring_occurrence_at عبر CHECK constraint chk_orders_recurring_identity_pair).
    if (query.recurring === 'true') where.recurringTemplateId = Not(IsNull());
    if (query.recurring === 'false') where.recurringTemplateId = IsNull();
    if (query.from && query.to) {
      where.placedAt = Between(new Date(query.from), new Date(query.to));
    } else if (query.from) {
      where.placedAt = MoreThanOrEqual(new Date(query.from));
    } else if (query.to) {
      where.placedAt = LessThanOrEqual(new Date(query.to));
    }

    // docs/08 §63.ب5 — بلاغ المالك: «الطلبات بتبقى مترتبة بطريقة شبه عشوائية».
    //
    // السبب الحقيقي: الترتيب كان `placedAt: 'DESC'` بس، و`placed_at` عمود **nullable**، وPostgres
    // بيحط NULL **الأول** في DESC افتراضيًا — فأي طلب من غير `placed_at` كان بيقفز فوق القايمة كلها.
    // وكمان مكانش فيه tie-break، فالطلبات اللي ليها نفس اللحظة كان ترتيبها غير محدد بين استعلام
    // والتاني (وده اللي بيدّي إحساس "عشوائي" حتى من غير NULLs).
    //
    // الإصلاح: `COALESCE(placed_at, created_at)` — الطلب اللي لسه ما اتسجّلش وقت طلبه بيترتّب بوقت
    // إنشائه بدل ما يقفز فوق أو يغرق تحت، + `id DESC` كـtie-break حتمي (uuid v7 مرتّب زمنيًا أصلاً).
    const qb = this.orders
      .createQueryBuilder('o')
      .where(where)
      .skip((page - 1) * perPage)
      .take(perPage);

    // docs/08 §67 — بحث برقم الطلب. §73 بند 3 وسّعه لاسم/تليفون العميل والفني وPayment ID —
    // بلاغ مالك صريح: "مركز الاتصال محتاج يدوّر برقم تليفون العميل مش رقم الطلب بس". `ILIKE` مع
    // `%…%` عشان الأدمن يقدر يلزق جزء بس. الحروف الخاصة بتاعت LIKE بتتهرّب، وإلا `%` اللي
    // المستخدم يكتبه بيبقى wildcard ويرجّع القايمة كلها بدل ما يفلتر. الـJOINs بتتضاف بس لو فيه
    // بحث فعلي — صفر تكلفة إضافية على القايمة العادية بلا بحث. قرار خصوصية موثّق (docs/08 §73):
    // كل الأدمن يقدروا يدوروا بالتليفون — نفس صلاحية عرض الصفحة كلها، مفيش تعقيد إضافي هنا.
    const search = query.search?.trim();
    if (search) {
      const escaped = search.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      qb.leftJoin('customer_profiles', 'cp', 'cp.id = o.customer_id')
        .leftJoin('users', 'cu', 'cu.id = cp.user_id')
        .leftJoin('technician_profiles', 'tp', 'tp.id = o.technician_id')
        .leftJoin('users', 'tu', 'tu.id = tp.user_id')
        .andWhere(
          `(o.order_number ILIKE :search ESCAPE '\\'
            OR cu.full_name ILIKE :search ESCAPE '\\'
            OR cu.phone_number ILIKE :search ESCAPE '\\'
            OR tu.full_name ILIKE :search ESCAPE '\\'
            OR tu.phone_number ILIKE :search ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.gateway_reference ILIKE :search ESCAPE '\\'))`,
          { search: `%${escaped}%` },
        );
    }

    if (query.sort === 'soonest') {
      // "اللي تنفيذه قرّب" — الأقرب موعدًا الأول. الطلبات بلا موعد محدد بتروح الآخر (NULLS LAST)
      // لأن السؤال هنا حرفيًا "إيه اللي هيتنفّذ قريب".
      qb.orderBy('o.scheduled_at', 'ASC', 'NULLS LAST').addOrderBy('o.id', 'DESC');
    } else {
      // بَقّة حقيقية اتلقطت وقت تطوير §73 بند 3 (بحث موسّع فوق): TypeORM بيرمي "COALESCE(o alias
      // was not found" لما orderBy عبارة عن تعبير SQL خام (مش alias.column بسيط) *مع* وجود
      // LEFT JOINs في نفس الاستعلام — بيحاول يحلل التعبير كـ"alias.column" بطريقة نصّية بسيطة
      // وبيتلخبط. الحل: alias صريح عبر addSelect بدل تمرير التعبير الخام مباشرة لـorderBy —
      // نفس النتيجة بالظبط، بس TypeORM بيتعامل معاه كعمود عادي.
      qb.addSelect('COALESCE(o.placed_at, o.created_at)', 'effective_placed_at')
        .orderBy('effective_placed_at', 'DESC')
        .addOrderBy('o.id', 'DESC');
    }

    const [items, total] = await qb.getManyAndCount();

    return { items, meta: { page, per_page: perPage, total } };
  }

  /**
   * ملخّص الطاقم لكل طلب في صفحة القايمة (docs/08 §63.ب5 — طلب مالك صريح: «يظهر إيه معلومات
   * جنبها هل الفريق كامل، مين اللي أخد الشغلانة دي، ومعاه مين»).
   *
   * **استعلام واحد لكل الصفحة**، مش استعلام لكل طلب — القايمة بتعرض 20 صف، وN+1 هنا كان هيبقى
   * 20 استعلام إضافي على أكتر شاشة بتتفتح في اللوحة.
   *
   * القائد بييجي من `orders.technician_id` (مش صف في `order_team_members` — نفس التوصيف الموجود
   * في `order-team.service.ts`)، والباقي من `order_team_members`. `crewComplete` بيستخدم نفس
   * `computeCrewComposition()` اللي تطبيق الفني وصفحة التفاصيل بيستخدموها — مصدر حقيقة واحد.
   */
  async crewSummaryForOrders(orders: Order[]): Promise<Map<string, OrderCrewSummary>> {
    const summary = new Map<string, OrderCrewSummary>();
    if (orders.length === 0) return summary;

    const orderIds = orders.map((o) => o.id);
    const leaderIds = orders.map((o) => o.technicianId).filter((id): id is string => id !== null);

    interface MemberRow {
      order_id: string;
      technician_id: string;
      member_type: string;
      full_name: string;
    }
    const memberRows = await this.teamMembers.manager.query<MemberRow[]>(
      `SELECT otm.order_id, otm.technician_id, otm.member_type, u.full_name
       FROM order_team_members otm
       JOIN technician_profiles tp ON tp.id = otm.technician_id
       JOIN users u ON u.id = tp.user_id
       WHERE otm.order_id = ANY($1::uuid[])
       ORDER BY otm.created_at ASC`,
      [orderIds],
    );

    interface LeaderRow { technician_id: string; full_name: string }
    const leaderRows = leaderIds.length
      ? await this.teamMembers.manager.query<LeaderRow[]>(
          `SELECT tp.id AS technician_id, u.full_name
           FROM technician_profiles tp JOIN users u ON u.id = tp.user_id
           WHERE tp.id = ANY($1::uuid[])`,
          [leaderIds],
        )
      : [];
    const leaderNames = new Map(leaderRows.map((r) => [r.technician_id, r.full_name]));

    for (const order of orders) {
      const members = memberRows.filter((r) => r.order_id === order.id);
      const technicians = members.filter((m) => m.member_type === 'team_member').length;
      const assistants = members.filter((m) => m.member_type === 'assistant').length;
      const composition = computeCrewComposition(order.requiredTechnicians, order.requiredAssistants, {
        technicians,
        assistants,
      });
      summary.set(order.id, {
        leaderTechnicianId: order.technicianId,
        leaderName: order.technicianId ? (leaderNames.get(order.technicianId) ?? null) : null,
        members: members.map((m) => ({
          technicianId: m.technician_id,
          fullName: m.full_name,
          memberType: m.member_type === 'assistant' ? 'assistant' : 'team_member',
        })),
        requiredTechnicians: order.requiredTechnicians ?? 0,
        requiredAssistants: order.requiredAssistants ?? 0,
        // الطلب الفردي مالوش "طاقم" أصلاً — كامل بمجرد ما فيه فني معيّن.
        crewComplete: order.bookingMode === BookingMode.TEAM ? composition.crewComplete : order.technicianId !== null,
        isTeamBooking: order.bookingMode === BookingMode.TEAM,
      });
    }
    return summary;
  }

  /**
   * حصص الطاقم لطلب واحد مع أسماء الفنيين (ADR-0040). استعلام واحد بـjoin — الشاشة محتاجة الاسم
   * مش الـid.
   */
  async listEarningShares(orderId: string): Promise<
    {
      technician_id: string;
      full_name: string;
      participant_role: string;
      technician_level: string;
      share_weight: string;
      calculation_method: 'weighted_pool' | 'assistant_level_wage' | 'earnings_policy_v2' | 'manual_override';
      assistant_base_wage_cents: number | null;
      assistant_level_multiplier: string | null;
      assistant_target_cents: number | null;
      pool_cents: number;
      share_cents: number;
      settlement_policy_version: 1 | 2;
      calculation_algorithm_version: string | null;
      technician_kind_snapshot: 'technician' | 'assistant' | null;
      earning_role: 'technician' | 'assistant' | null;
      level_weight_bps_snapshot: number | null;
      assistant_ratio_bps_snapshot: number | null;
      service_skill_snapshot: string | null;
      service_skill_factor_bps_snapshot: number | null;
      individual_adjustment_bps_snapshot: number | null;
      order_adjustment_bps_snapshot: number | null;
      effective_weight_units: string | null;
      is_preview: boolean;
    }[]
  > {
    const settled = await this.teamMembers.manager.query(
      `SELECT oes.technician_id, u.full_name, oes.participant_role, oes.technician_level,
              oes.share_weight, oes.pool_cents, oes.share_cents, oes.calculation_method,
              oes.assistant_base_wage_cents, oes.assistant_level_multiplier, oes.assistant_target_cents,
              oes.settlement_policy_version, oes.calculation_algorithm_version,
              oes.technician_kind_snapshot, oes.earning_role,
              oes.level_weight_bps_snapshot, oes.assistant_ratio_bps_snapshot,
              oes.service_skill_snapshot, oes.service_skill_factor_bps_snapshot,
              oes.individual_adjustment_bps_snapshot, oes.order_adjustment_bps_snapshot,
              oes.effective_weight_units, false AS is_preview
         FROM order_earning_shares oes
         JOIN technician_profiles tp ON tp.id = oes.technician_id
         JOIN users u ON u.id = tp.user_id
        WHERE oes.order_id = $1 AND oes.deleted_at IS NULL
        ORDER BY oes.share_cents DESC`,
      [orderId],
    );
    if (settled.length > 0) return settled;

    const order = await this.findOrThrow(orderId);
    if (order.settlementPolicyVersion !== 2 || !order.technicianId) return [];
    if (!this.earningsPolicyService) throw new Error('EarningsPolicyService is required for a V2 admin preview');

    const calculation = await this.earningsPolicyService.calculateOrder(order.id, order.totalAmountCents);
    const ids = calculation.participantShares.map((share) => share.technicianId);
    const names: Array<{ technician_id: string; full_name: string }> = await this.dataSource.query(
      `SELECT tp.id AS technician_id, u.full_name
         FROM technician_profiles tp JOIN users u ON u.id = tp.user_id
        WHERE tp.id = ANY($1::uuid[])`,
      [ids],
    );
    const namesById = new Map(names.map((row) => [row.technician_id, row.full_name]));
    return calculation.participantShares.map((share) => ({
      technician_id: share.technicianId,
      full_name: namesById.get(share.technicianId) ?? share.technicianId,
      participant_role: share.isLeader ? 'leader' : share.earningRole === 'assistant' ? 'assistant' : 'team_member',
      technician_level: share.technicianLevel,
      share_weight: (share.levelWeightBps / 10_000).toFixed(2),
      calculation_method: 'earnings_policy_v2' as const,
      assistant_base_wage_cents: null,
      assistant_level_multiplier: null,
      assistant_target_cents: null,
      pool_cents: calculation.workerPoolCents,
      share_cents: share.shareCents,
      settlement_policy_version: 2 as const,
      calculation_algorithm_version: calculation.calculationAlgorithmVersion,
      technician_kind_snapshot: share.technicianKindSnapshot,
      earning_role: share.earningRole,
      level_weight_bps_snapshot: share.levelWeightBps,
      assistant_ratio_bps_snapshot: share.assistantRatioBps,
      service_skill_snapshot: share.serviceSkill,
      service_skill_factor_bps_snapshot: share.serviceSkillFactorBps,
      individual_adjustment_bps_snapshot: share.individualAdjustmentBps ?? 0,
      order_adjustment_bps_snapshot: share.orderAdjustmentBps ?? 0,
      effective_weight_units: share.effectiveWeightUnits,
      is_preview: true,
    }));
  }

  private async findOrThrow(orderId: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  async getDetail(orderId: string): Promise<{
    order: Order;
    history: OrderStatusHistory[];
    pricingEvaluation: ServicePricingEvaluation | null;
    technicianCancellations: TechnicianOrderCancellation[];
    crewStatus: ReturnType<typeof computeCrewComposition> | null;
    crewShortageUrgent: boolean;
  }> {
    const order = await this.findOrThrow(orderId);
    const history = await this.statusHistory.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    const pricingEvaluation = await this.pricingEngineService.findEvaluationForOrder(orderId);
    // سياسة إلغاء الفني (docs/10) — "surface immediately in operations/audit views" — كارت جديد
    // في /admin/orders/:id، صفر شاشة منفصلة (نفس فلسفة pricing_evaluation فوق بالحرف).
    const technicianCancellations = await this.technicianOrderCancellations.find({
      where: { orderId },
      order: { cancelledAt: 'ASC' },
    });
    // docs/08 §35، ADR-0021 §1 — نفس crewStatus اللي apps/technician-app بيشوفه بالظبط (مصدر
    // حقيقة واحد)، عشان الأدمن يشوف الحالة الحقيقية للطاقم بلا حاجة يعدّ الأعضاء يدويًا.
    let crewStatus: ReturnType<typeof computeCrewComposition> | null = null;
    let crewShortageUrgent = false;
    if (order.bookingMode === BookingMode.TEAM) {
      const rows = await this.teamMembers.manager.query<{ member_type: string; count: string }[]>(
        `SELECT member_type, COUNT(*) AS count FROM order_team_members WHERE order_id = $1 GROUP BY member_type`,
        [orderId],
      );
      const technicians = Number(rows.find((r) => r.member_type === 'team_member')?.count ?? 0);
      const assistants = Number(rows.find((r) => r.member_type === 'assistant')?.count ?? 0);
      crewStatus = computeCrewComposition(order.requiredTechnicians, order.requiredAssistants, { technicians, assistants });

      // "الطلب مميّز بصريًا" (docs/08 §35.5) — محسوب وقت القراءة، مش state مخزّن (ADR-0021 §5):
      // نفس عتبة CrewShortageEscalationService بالظبط (orders.crew_shortage_escalation_hours_before)
      // عشان "الأدمن بيتصعّدله إشعار" و"الطلب باين مميّز" يفضلوا متسقين مع بعض دايمًا.
      if (!crewStatus.crewComplete && order.scheduledAt) {
        const hoursBefore = await this.settingsService.getNumber('orders.crew_shortage_escalation_hours_before', 24);
        crewShortageUrgent = order.scheduledAt.getTime() - Date.now() <= hoursBefore * 60 * 60 * 1000;
      }
    }
    return { order, history, pricingEvaluation, technicianCancellations, crewStatus, crewShortageUrgent };
  }

  /**
   * Timeline موحّد لتفاصيل الطلب (Script 4 Part G §30-32) — كانت فجوة موثّقة صراحة: 4 مصادر
   * منفصلة (audit_logs, order_status_history, order_assignments, technician_order_cancellations)
   * كل واحدة في كارت لوحدها، الأدمن مضطر يقفز بين 4 أماكن يركّب الصورة الكاملة يدويًا. UNION ALL
   * واحدة بترجّع تسلسل زمني واحد مرتّب، مع اسم الفاعل (لو موجود) جاهز — صفر N+1 queries على
   * apps/admin بعدها.
   */
  async getTimeline(orderId: string): Promise<OrderTimelineEventRow[]> {
    await this.findOrThrow(orderId);
    return this.orders.manager.query<OrderTimelineEventRow[]>(
      `WITH events AS (
         SELECT
           id, created_at AS ts, 'status_history' AS source,
           concat('الحالة اتغيّرت من ', COALESCE(previous_status::text, '—'), ' لـ ', new_status::text) AS title,
           jsonb_build_object(
             'previous_status', previous_status, 'new_status', new_status, 'reason', reason,
             'changed_by_role', changed_by_role, 'change_source', change_source
           ) AS detail,
           changed_by_user_id AS actor_user_id
         FROM order_status_history WHERE order_id = $1

         UNION ALL

         SELECT
           id, created_at AS ts, 'audit_log' AS source,
           action AS title,
           jsonb_build_object('old_values', old_values, 'new_values', new_values, 'actor_role', actor_role) AS detail,
           actor_user_id
         FROM audit_logs WHERE entity_type = 'order' AND entity_id = $1

         UNION ALL

         SELECT
           id, sent_at AS ts, 'assignment' AS source,
           concat('عرض جولة ', assignment_round::text, ' — ', assignment_status::text) AS title,
           jsonb_build_object(
             'technician_id', technician_id, 'assignment_round', assignment_round,
             'assignment_status', assignment_status, 'distance_km', distance_km,
             'responded_at', responded_at, 'rejection_reason_code', rejection_reason_code
           ) AS detail,
           NULL::uuid AS actor_user_id
         FROM order_assignments WHERE order_id = $1

         UNION ALL

         SELECT
           id, cancelled_at AS ts, 'technician_cancellation' AS source,
           'الفني ألغى الطلب بعد القبول' AS title,
           jsonb_build_object(
             'technician_id', technician_id, 'reason_text', reason_text,
             'within_policy_window', within_policy_window, 'fee_cents', fee_cents,
             'recovery_action', recovery_action
           ) AS detail,
           technician_user_id AS actor_user_id
         FROM technician_order_cancellations WHERE order_id = $1

         UNION ALL

         -- docs/08 §35.14 — فرص التوزيع/التجنيد (technician_work_opportunities، §34.1/§35.1-3) —
         -- كانت غايبة تمامًا عن الـtimeline قبل كده (بس order_assignments، مش الفرص الاختيارية
         -- LIGHT/MEANINGFUL/HEAVY ولا فرص تجنيد الفريق crew_recruit).
         SELECT
           id, offered_at AS ts, 'work_opportunity' AS source,
           concat(
             CASE WHEN context = 'crew_recruit' THEN 'فرصة انضمام لفريق' ELSE 'فرصة عمل إضافي' END,
             ' — ', status::text
           ) AS title,
           jsonb_build_object(
             'technician_id', technician_id, 'context', context, 'crew_role', crew_role,
             'capacity_tier_at_offer', capacity_tier_at_offer, 'status', status, 'decided_at', decided_at
           ) AS detail,
           NULL::uuid AS actor_user_id
         FROM technician_work_opportunities WHERE order_id = $1 AND deleted_at IS NULL

         UNION ALL

         -- docs/08 §35.14 — تصعيد نقص طاقم (§35.5، CrewShortageEscalationService) — صف واحد
         -- تركيبي من عمود orders.crew_shortage_escalated_at نفسه (صفر جدول جديد)، بيظهر بس لو
         -- الطلب اتصعّد فعلاً.
         SELECT
           o.id, o.crew_shortage_escalated_at AS ts, 'crew_shortage_escalation' AS source,
           'تصعيد نقص طاقم للأدمن (قبل الموعد بمهلة قليلة)' AS title,
           NULL::jsonb AS detail,
           NULL::uuid AS actor_user_id
         FROM orders o WHERE o.id = $1 AND o.crew_shortage_escalated_at IS NOT NULL
       )
       SELECT e.id, e.ts, e.source, e.title, e.detail, e.actor_user_id AS "actorUserId",
              u.full_name AS "actorFullName", u.user_type AS "actorUserType"
       FROM events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       ORDER BY e.ts ASC`,
      [orderId],
    );
  }

  async cancel(adminUserId: string, orderId: string, reason: string, meta?: AuditActorMeta): Promise<Order> {
    const order = await this.findOrThrow(orderId);
    if (!canTransition(order.orderStatus, OrderStatus.CANCELLED_BY_SYSTEM)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تلغي الطلب وهو في حالة ${order.orderStatus} — بعد قبول الفني الإلغاء لازم يعدّي من الشكوى`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = order.orderStatus;
    const cancelledOrder = await this.dataSource.transaction(async (manager) => {
      const lockedOrder = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (
        !lockedOrder ||
        lockedOrder.orderStatus !== previousStatus ||
        !canTransition(lockedOrder.orderStatus, OrderStatus.CANCELLED_BY_SYSTEM)
      ) {
        throw new ApiException(ErrorCode.ORDR_003, 'حالة الطلب اتغيّرت بالفعل — حاول تاني', HttpStatus.CONFLICT);
      }
      lockedOrder.orderStatus = OrderStatus.CANCELLED_BY_SYSTEM;
      lockedOrder.cancelledAt = new Date();
      lockedOrder.cancelledByUserId = adminUserId;
      await manager.save(lockedOrder);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: lockedOrder.id,
          previousStatus,
          newStatus: OrderStatus.CANCELLED_BY_SYSTEM,
          changedByUserId: adminUserId,
          changedByRole: 'admin',
          changeSource: OrderChangeSource.ADMIN,
          reason,
        }),
      );

      await this.promoCodesService.releaseUsage(manager, lockedOrder.id);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.cancelled_by_admin',
          entityType: 'order',
          entityId: lockedOrder.id,
          oldValues: { order_status: previousStatus },
          newValues: { order_status: OrderStatus.CANCELLED_BY_SYSTEM, reason },
          meta,
        },
        manager,
      );
      return lockedOrder;
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        cancelledOrder.id,
        cancelledOrder.orderNumber,
        previousStatus,
        OrderStatus.CANCELLED_BY_SYSTEM,
        cancelledOrder.customerId,
        cancelledOrder.technicianId,
        reason,
        adminUserId,
      ),
    );

    return cancelledOrder;
  }

  /**
   * ADR-0017 بند 4 — قايمة الفنيين المرشحين للتعيين القسري/إعادة التعيين لازم تعكس **نفس**
   * منطق الأهلية المستخدم فعليًا وقت التنفيذ (assertEligible)، مش قايمة "كل الفنيين المعتمدين"
   * عامة كانت بتخلي الأدمن يختار من dropdown يكتشف بعد كده إن الباك إند بيرفضه لسبب كان
   * ممكن يتعرض قبل المحاولة أصلاً. بتعيد استخدام listForServiceBooking بالحرف (نفس مصدر
   * الأهلية اللي العميل شايفه)، بس مقيّدة بموعد/خدمة/عنوان الطلب الحقيقي نفسه.
   */
  async listEligibleTechniciansForReassign(orderId: string) {
    const order = await this.findOrThrow(orderId);
    // docs/08 §38 — طلب اعتماد لازم قايمة إعادة التعيين تفضل مقيّدة بنفس فلترة المستوى (محترف
    // فأعلى) اللي assertCoreEligibility() هيرفض غيرها وقت التنفيذ فعليًا — نفس فلسفة التعليق فوق.
    const result = await this.techniciansService.listForServiceBooking(
      order.serviceId,
      order.addressId,
      order.technicianId ?? undefined,
      order.scheduledAt,
      order.bookingMode === BookingMode.TEAM,
      false,
      // ADR-0064 §3 — الطلب ده موجود فعلاً، فحمله التشغيلي متخزّن عليه. من غير ما يتبعت، قايمة
      // إعادة التعيين كانت بتقيس كل مرشّح على «يوم واحد» حتى لو الطلب ممتد لشهور، فالأدمن يشوف
      // فني «متاح» والتوزيع الفعلي (اللي بيقرا نفس الأعمدة دي من صف الطلب) يرفضه.
      {
        durationMinutes: order.durationMinutes ?? (order.durationHours !== null ? Math.round(order.durationHours * 60) : null),
        estimatedDurationDays: order.estimatedDurationDays,
      },
    );
    const formatted = formatEligibleTechniciansForAdmin(result);
    return { ...formatted, items: await this.attachAdminRoleMetadata(formatted.items) };
  }

  /**
   * بيلحق `technicianKind`/`currentLevel` بصفوف قايمة إدارية (docs/08 §107 — رمز الدور جنب
   * الاسم: FN فني / HF مساعد).
   *
   * استعلام إضافي صغير عمدًا بدل إضافة العمود لـ`TechnicianBookingListItem` نفسه: النوع ده
   * بيتقدّم كمان لتطبيق العميل (`listForServiceBooking` هو نفس مصدر شاشة اختيار الفني)، وإضافة
   * الدور هناك كانت هتسرّب تصنيف داخلي للعميل — والمالك طلب صراحة إن الرمز ده «مايبانش لحد غير
   * للأدمن». المسار ده إداري بحت، فالإثراء بيحصل هنا بس.
   */
  private async attachAdminRoleMetadata<T extends { technicianId: string }>(
    items: T[],
  ): Promise<(T & { technicianKind: 'technician' | 'assistant'; currentLevel: string | null })[]> {
    if (items.length === 0) return [];
    const rows = await this.dataSource.query<
      { id: string; technician_kind: 'technician' | 'assistant'; current_level: string }[]
    >(`SELECT id, technician_kind, current_level FROM technician_profiles WHERE id = ANY($1::uuid[])`, [
      items.map((item) => item.technicianId),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return items.map((item) => ({
      ...item,
      // الافتراضي 'technician' لو الصف اختفى بين الاستعلامين — الرمز عرض بس، ما ينفعش يكسّر القايمة.
      technicianKind: byId.get(item.technicianId)?.technician_kind ?? 'technician',
      currentLevel: byId.get(item.technicianId)?.current_level ?? null,
    }));
  }

  /**
   * مرشّحو **مفتّش المطابقة** (docs/08 §107) — مصدر منفصل تمامًا عن قايمة التعيين الإجباري فوق.
   *
   * بلاغ المالك كان «المساعدين مش ظاهرين في خانة ليه/ليه لأ». التشخيص الحي أثبت إن السبب مش
   * فلترة دور (مفيش أي شرط `technician_kind` في شجرة الأهلية أصلاً) لكنه عيب تصميمي أعمق:
   * الخانة دي كانت بتتغذّى من `listEligibleTechniciansForReassign()` اللي بيرجّع **المؤهّلين
   * فقط** — يعني سؤال «ليه ده مش مختار؟» مستحيل تسأله، لأن أي حد إجابته «لأ» بيتشال من نفس
   * القايمة اللي المفروض تختاره منها. (اللي كان بيخفي مساعدي المالك تحديدًا هو شرط
   * `eligible_for_team_booking` على طلبات الاعتماد — نفس الشرط بيخفي الفني الجديد بالظبط.)
   *
   * فالقايمة دي عمدًا **بلا أي بوابة أهلية**: كل معتمد في **مدينة** نطاق الطلب (نفس حد المدينة
   * بتاع ADR-0056، عشان القايمة تفضل معقولة الحجم بدل كل فني في البلد)، فني كان أو مساعد،
   * ومعاه `is_eligible_now` عشان الواجهة تفرّق بصريًا. التفسير نفسه
   * (`explainTechnicianForOrder`) شغال أصلاً لأي صف في `technician_profiles` بغض النظر عن الدور
   * أو الأهلية — هو اللي بيرجّع الـchecks اللي بتقول «ليه لأ» بالنص.
   */
  async listExplainCandidates(orderId: string) {
    const order = await this.findOrThrow(orderId);
    if (!order.serviceZoneId) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الطلب ده مالوش نطاق خدمة محدد — مفيش مطابقة ممكنة عليه أصلاً',
        HttpStatus.BAD_REQUEST,
      );
    }

    // المؤهّلون فعلاً دلوقتي — نفس مصدر التعيين الإجباري بالحرف، عشان العلامة اللي الواجهة
    // بتعرضها تبقى متطابقة مع اللي الأدمن هيلاقيه في dropdown التعيين، مش تقدير موازي.
    const eligible = await this.listEligibleTechniciansForReassign(orderId);
    const eligibleIds = new Set(eligible.items.map((item) => item.technicianId));

    const rows = await this.dataSource.query<
      {
        technician_id: string;
        full_name: string;
        technician_kind: 'technician' | 'assistant';
        current_level: string;
        has_location: boolean;
      }[]
    >(
      `SELECT tp.id AS technician_id, u.full_name, tp.technician_kind, tp.current_level,
              (tp.current_location IS NOT NULL) AS has_location
       FROM technician_profiles tp
       JOIN users u ON u.id = tp.user_id
       WHERE tp.deleted_at IS NULL
         AND tp.verification_status = 'approved'
         AND ${technicianCityCoverageCondition({
           technicianIdExpr: 'tp.id',
           requestedServiceZoneIdExpr: '$1',
         })}
       ORDER BY tp.technician_kind ASC, u.full_name ASC
       LIMIT 300`,
      [order.serviceZoneId],
    );

    return {
      items: rows.map((row) => ({
        technicianId: row.technician_id,
        fullName: row.full_name,
        technicianKind: row.technician_kind,
        currentLevel: row.current_level,
        hasLocation: row.has_location,
        isEligibleNow: eligibleIds.has(row.technician_id),
      })),
    };
  }

  /**
   * ADR-0051 (docs/08 §96) — تحرير إعادة زيارة مثبّتة للتوزيع العام + الخصم على الفني الأصلي.
   *
   * **الحارس الحاسم (نص المالك بالحرف): «لازم يكون الفني الطلب مش عنده… طالما الطلب عنده موجود،
   * خلاص مش هناخد أي action»** — الشرط ده مشتقّ من مصادر الحقيقة الفعلية (`order_assignments`
   * المرفوضة، `technician_order_cancellations`، أو عدّت مهلة الرد)، مش من عمود حالة يدوي ممكن
   * يتلغبط. لو الفني لسه شايل الطلب فعلاً، الطلب بيترفض بوضوح ومفيش أي خصم.
   *
   * **الخصم = نصيبه الفعلي من الطلب الأصلي**، مقروء من `order_earning_shares` (نفس مصدر الحقيقة
   * بتاع كشف المستحقات والمحفظة) — مش إجمالي الطلب (ده عقوبة مخترعة، الفني ما خدش الإجمالي أصلاً)
   * ومش مبلغ يدوي من الأدمن. الشركة بتتحمّل تكلفة إعادة الزيارة الجديدة، والفني بيرجّع اللي خده.
   *
   * `revisit_released_at` هو الحارس ضد التكرار: التحرير (والخصم معاه) مستحيل يحصل مرتين.
   */
  async releaseRevisit(
    adminUserId: string,
    orderId: string,
    meta?: AuditActorMeta,
  ): Promise<{ order: Order; reason: RevisitReleaseReason; chargebackCents: number }> {
    const windowHours = await this.settingsService.getNumber(
      REVISIT_RESPONSE_WINDOW_HOURS_SETTING,
      REVISIT_RESPONSE_WINDOW_HOURS_FALLBACK,
    );

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.ORDR_001, 'الطلب مش موجود', HttpStatus.NOT_FOUND);
      }
      if (order.revisitPinnedTechnicianId === null) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش إعادة زيارة مثبّتة على فني', HttpStatus.CONFLICT);
      }
      if (order.revisitReleasedAt !== null) {
        throw new ApiException(ErrorCode.VAL_001, 'إعادة الزيارة دي اتحررت قبل كده', HttpStatus.CONFLICT);
      }

      const pinState = await loadRevisitPinState(manager, order, windowHours);
      if (!pinState.exhausted) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'الفني الأصلي لسه الطلب عنده — مينفعش تحرير ولا خصم قبل ما يرفض/يلغي أو تعدي مهلة الرد',
          HttpStatus.CONFLICT,
        );
      }
      const reason: RevisitReleaseReason = pinState.reason === 'refused' ? 'refused' : 'no_response';
      const technicianId = pinState.technicianId!;

      // نصيبه الفعلي من الطلب الأصلي — order_earning_shares أولاً (الطلبات الطاقمية والفردية
      // الحديثة)، وbackfill لـtechnician_earning_cents للطلبات القديمة اللي اتقفلت قبل نظام الحصص.
      const [share] = await manager.query<Array<{ chargeback_cents: string | null }>>(
        `SELECT COALESCE(
                  (SELECT oes.share_cents FROM order_earning_shares oes
                    WHERE oes.order_id = parent.id AND oes.technician_id = $2 AND oes.deleted_at IS NULL),
                  parent.technician_earning_cents,
                  0
                ) AS chargeback_cents
           FROM orders parent WHERE parent.id = $1`,
        [order.parentOrderId, technicianId],
      );
      const chargebackCents = Math.max(0, Number(share?.chargeback_cents ?? 0));

      const now = new Date();
      order.revisitReleasedAt = now;
      order.revisitReleaseReason = reason;
      // التفضيل الناعم بيتشال كمان — لولا كده، أول جولة بعد التحرير كانت هتحاول نفس الفني تاني.
      order.requestedTechnicianId = null;
      await manager.save(order);

      if (chargebackCents > 0) {
        const technician = await this.techniciansService.findByProfileIdOrThrow(technicianId);
        const technicianWallet = await this.walletsService.getOrCreateWallet(
          technician.userId,
          WalletOwnerType.TECHNICIAN,
          manager,
        );
        const platformWallet = await this.walletsService.findByUserIdOrThrow(PLATFORM_SYSTEM_USER_ID, manager);
        await this.walletsService.doubleEntry(
          {
            fromWalletId: technicianWallet.id,
            toWalletId: platformWallet.id,
            amountCents: chargebackCents,
            transactionType: WalletTxType.PENALTY,
            // المرجع هو **الطلب الأصلي** مش إعادة الزيارة — الفلوس اللي بترجع هي فلوس الشغلانة
            // الأصلية، فالقيد لازم يبان في كشف الطلب ده هو.
            referenceType: 'order',
            referenceId: order.parentOrderId ?? order.id,
            descriptionAr: `استرداد أرباح طلب ${order.orderNumber} — إعادة زيارة تحت الضمان اتحرّرت لفني تاني`,
            performedByUserId: adminUserId,
            // خصم بيعمله النظام على أرباح اتصرفت خلاص — الرصيد ممكن يبقى سالب (دَين على الفني)،
            // زي عمولة الكاش بالظبط. TechnicianDebtService بيتابع الدَين ده من نفس الدفتر.
            allowNegativeBalance: true,
          },
          manager,
        );
      }

      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.revisit_released',
          entityType: 'order',
          entityId: order.id,
          oldValues: { revisit_pinned_technician_id: technicianId, revisit_released_at: null },
          newValues: { revisit_released_at: now.toISOString(), revisit_release_reason: reason, chargeback_cents: chargebackCents },
          meta,
        },
        manager,
      );

      return { order, reason, chargebackCents };
    });

    // التوزيع العادي بيبتدي بعد ما الـtransaction تثبت — الطلب بقى بلا تثبيت فبيمشي في المسار
    // العادي بالظبط (نفس فلوس الطلب الأصلي، الشركة متحمّلة التكلفة).
    this.events.emit(ORDER_REMATCH_REQUESTED_EVENT, new OrderRematchRequestedEvent(result.order.id));
    return result;
  }

  async reassign(
    adminUserId: string,
    orderId: string,
    newTechnicianProfileId: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const snapshot = await this.findOrThrow(orderId);
    if (!REASSIGNABLE_STATUSES.has(snapshot.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تعيّن فني يدوي والطلب في حالة ${snapshot.orderStatus} — التعيين متاح قبل ما أي فني يقبل الطلب بس`,
        HttpStatus.CONFLICT,
      );
    }

    const technician = await this.techniciansService.findByProfileIdOrThrow(newTechnicianProfileId);
    if (snapshot.technicianId === technician.id) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده معيّن للفني ده بالفعل', HttpStatus.CONFLICT);
    }

    const result = await this.dataSource.transaction(async (manager) => {
      // نفس ترتيب MatchingService.accept(): المورد المشترك (الفني) أولًا، ثم الطلب.
      const lockedTechnician = await this.assignmentGuard.lockTechnician(manager, technician.id);
      const order = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (!order || !REASSIGNABLE_STATUSES.has(order.orderStatus)) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب اتغير أو اتقبله فني بالفعل', HttpStatus.CONFLICT);
      }
      if (order.technicianId === lockedTechnician.id) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده معيّن للفني ده بالفعل', HttpStatus.CONFLICT);
      }
      await this.assignmentGuard.assertEligible(manager, lockedTechnician, order);

      const previousStatus = order.orderStatus;
      const previousTechnicianId = order.technicianId;
      const now = new Date();
      order.technicianId = lockedTechnician.id;

      // كانت فجوة موثّقة: التعيين اليدوي مكانش بيلغي عروض الجولة الأصلية (sent/viewed) لباقي
      // الفنيين المرشحين — فني تاني كان يفضل شايف الطلب في GET /technician/orders/available
      // لحد ما يحاول يقبله فيترفض بأمان وقتها (الحالة بقت مش searching_technician)، مش تعيين
      // مزدوج حقيقي، بس تجربة استخدام مش نضيفة. نفس النمط بالظبط المُستخدم في
      // matching.service.ts's accept() — إلغاء صريح بدل ما نستنى الرفض وقت المحاولة.
      await manager.update(
        OrderAssignment,
        { orderId, assignmentStatus: In([AssignmentStatus.SENT, AssignmentStatus.VIEWED]) },
        { assignmentStatus: AssignmentStatus.CANCELLED, respondedAt: now },
      );

      // لازم نعدّي بنفس المسارين المعرّفين في order-state-machine.ts بالظبط
      // (searching_technician→technician_assigned→accepted)، مش قفزة مباشرة —
      // التعيين اليدوي معناه إن الأدمن أكّد مع الفني تليفونياً بالفعل، فمفيش
      // داعي إنه "يقبل" تاني من التطبيق، بس لازم يمر بنفس الانتقالات المسموحة.
      if (previousStatus === OrderStatus.SEARCHING_TECHNICIAN) {
        order.orderStatus = OrderStatus.TECHNICIAN_ASSIGNED;
        order.assignedAt = now;
        await manager.save(order);
        await manager.save(
          manager.create(OrderStatusHistory, {
            orderId: order.id,
            previousStatus,
            newStatus: OrderStatus.TECHNICIAN_ASSIGNED,
            changedByUserId: adminUserId,
            changedByRole: 'admin',
            changeSource: OrderChangeSource.ADMIN,
            reason: 'تعيين يدوي من الإدارة',
          }),
        );
      }

      order.orderStatus = OrderStatus.ACCEPTED;
      order.acceptedAt = now;
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: OrderStatus.TECHNICIAN_ASSIGNED,
          newStatus: OrderStatus.ACCEPTED,
          changedByUserId: adminUserId,
          changedByRole: 'admin',
          changeSource: OrderChangeSource.ADMIN,
          reason: 'تعيين يدوي من الإدارة',
        }),
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.reassigned_by_admin',
          entityType: 'order',
          entityId: order.id,
          oldValues: { order_status: previousStatus, technician_id: previousTechnicianId },
          newValues: { order_status: order.orderStatus, technician_id: technician.id },
          meta,
        },
        manager,
      );
      return { order, previousStatus, previousTechnicianId };
    });

    this.events.emit(
      ORDER_REASSIGNED_EVENT,
      new OrderReassignedEvent(result.order.id, result.order.orderNumber, technician.id),
    );

    return result.order;
  }

  async adjustPrice(
    adminUserId: string,
    orderId: string,
    newTotalAmountCents: number,
    reason: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.ORDR_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.paymentStatus === OrderPaymentStatus.PAID) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'الطلب اتدفع بالفعل — مينفعش تعدّل السعر مباشرة، لازم يعدّي من مسار استرداد/تحصيل إضافي',
          HttpStatus.CONFLICT,
        );
      }
      if (PRICE_LOCKED_STATUSES.has(order.orderStatus)) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          `مينفعش تعدّل سعر الطلب وهو في حالة ${order.orderStatus}`,
          HttpStatus.CONFLICT,
        );
      }
      if (newTotalAmountCents === order.totalAmountCents) {
        throw new ApiException(ErrorCode.VAL_001, 'السعر الجديد نفس السعر الحالي', HttpStatus.CONFLICT);
      }

      const financialChange = await this.orderFinancials.replaceUncommittedPrice(
        manager,
        order,
        newTotalAmountCents,
      );
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.price_adjusted_by_admin',
          entityType: 'order',
          entityId: order.id,
          oldValues: {
            total_amount_cents: financialChange.previousTotalCents,
            commissionable_base_cents: financialChange.previousCommissionableBaseCents,
          },
          newValues: {
            total_amount_cents: financialChange.newTotalCents,
            commissionable_base_cents: financialChange.newCommissionableBaseCents,
            reason,
          },
          meta,
        },
        manager,
      );
      return order;
    });
  }

  // تعيين مساعد يدوي بعد تصعيد مطابقة المساعد التلقائية (ADR-0008، يمتد ADR-0007 §7 اللي أجّل
  // الحل ده صراحة). فعل نادر تشغيلي — بلا قفل pessimistic_write زي AssistantMatchingService.accept()
  // (راجع تبرير ADR-0008 §2: سباق بين أدمنين اتنين نادر ومقبول، مش مسار مالي حرج).
  /**
   * ADR-0057 — كانت القايمة دي بلا أي فحص سكدول/قدرة استيعابية خالص، حتى لفني حاظر اليوم ده
   * بنفسه (BLOCKED). دلوقتي بترجّع `capacity_tier` لكل مرشّح وتستبعد BLOCKED وأي حد عنده تعارض
   * زمني فعلي — نفس منطق `OrderTeamService.listRecruitCandidates()` بالحرف.
   */
  async listEligibleAssistants(orderId: string): Promise<
    Array<{
      technician_id: string;
      full_name: string;
      technician_code: string;
      current_level: string;
      distance_km: string | null;
      capacity_tier: TechnicianCapacityTier;
    }>
  > {
    const order = await this.findOrThrow(orderId);
    if (!order.serviceZoneId) return [];
    const rows = await this.dataSource.query<
      { technician_id: string; full_name: string; technician_code: string; current_level: string; distance_km: string | null }[]
    >(
      `SELECT tp.id AS technician_id, u.full_name, tp.technician_code,
              tp.current_level, ST_Distance(tp.current_location, a.location) / 1000.0 AS distance_km
       FROM technician_profiles tp
       JOIN users u ON u.id = tp.user_id
       JOIN services svc ON svc.id = $2
       JOIN addresses a ON a.id = $4
       LEFT JOIN technician_services ts
         ON ts.technician_id = tp.id AND ts.service_id = svc.id
        AND ts.is_active = true AND ts.verification_status = 'approved'
       WHERE tp.technician_kind = 'assistant'
         AND tp.verification_status = 'approved'
         AND tp.deleted_at IS NULL
         AND tp.current_location IS NOT NULL
         AND tp.id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         AND ${technicianServiceQualificationCondition({
           technicianIdExpr: 'tp.id',
           serviceIdExpr: 'svc.id',
           categoryIdExpr: 'svc.category_id',
           directServiceAlias: 'ts',
         })}
         AND ${technicianCityCoverageCondition({
           technicianIdExpr: 'tp.id',
           requestedServiceZoneIdExpr: '$1',
         })}
         AND NOT EXISTS (
           SELECT 1 FROM order_team_members otm
           WHERE otm.order_id = $5 AND otm.technician_id = tp.id
         )
       ORDER BY distance_km ASC NULLS LAST,
                CASE tp.current_level
                  WHEN 'team_leader' THEN 4 WHEN 'premium' THEN 3 WHEN 'professional' THEN 2
                  WHEN 'verified' THEN 1 ELSE 0
                END DESC,
                tp.average_rating DESC`,
      [order.serviceZoneId, order.serviceId, order.technicianId, order.addressId, order.id],
    );

    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const [service] = await this.dataSource.query<{ estimated_duration_minutes: number | null }[]>(
      `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
      [order.serviceId],
    );
    const serviceDurationMinutes = service?.estimated_duration_minutes ?? 60;
    const withCapacity = await Promise.all(
      rows.map(async (row) => {
        const scheduleAvailable = await this.assignmentGuard.isScheduleAvailable(this.dataSource.manager, row.technician_id, order);
        if (!scheduleAvailable) return null;
        const capacity_tier = await classifyTechnicianCapacity(this.dataSource, {
          technicianId: row.technician_id,
          scheduledAt: order.scheduledAt,
          excludeOrderId: order.id,
          serviceDurationMinutes,
          dailyCapacityMinutes: dailyCapacityMinutes,
        });
        return { ...row, capacity_tier };
      }),
    );
    return withCapacity.filter(
      (row): row is (typeof rows)[number] & { capacity_tier: TechnicianCapacityTier } => row !== null && row.capacity_tier !== 'BLOCKED',
    );
  }

  async assignAssistant(
    adminUserId: string,
    orderId: string,
    technicianProfileId: string,
    meta?: AuditActorMeta,
  ): Promise<CrewAssignOutcome> {
    const order = await this.findOrThrow(orderId);
    if (order.orderType === OrderType.REVISIT) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'إعادة الزيارة المجانية لا تقبل مساعدًا بلا أجر — أنشئ دعمًا مدفوعًا مستقلًا لو مطلوب',
        HttpStatus.CONFLICT,
      );
    }
    if (!order.requiredAssistants || order.requiredAssistants <= 0) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش محتاج مساعد أصلاً', HttpStatus.CONFLICT);
    }

    const filled = await this.teamMembers.count({ where: { orderId, memberType: ASSISTANT_MEMBER_TYPE } });
    if (filled >= order.requiredAssistants) {
      throw new ApiException(ErrorCode.ORDR_003, 'الأماكن المطلوبة اكتملت بالفعل', HttpStatus.CONFLICT);
    }

    const technician = await this.techniciansService.findByProfileIdOrThrow(technicianProfileId);
    if (technician.verificationStatus !== TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.TECH_001, 'الفني ده لسه مش معتمد', HttpStatus.BAD_REQUEST);
    }
    if (order.technicianId === technician.id) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده هو قائد الطلب بالفعل، مينفعش يبقى مساعد كمان', HttpStatus.CONFLICT);
    }
    const [scope] = await this.dataSource.query<{
      correct_kind: boolean;
      approved_specialty: boolean;
      same_city: boolean;
    }[]>(
      `SELECT
         (tp.technician_kind = 'assistant') AS correct_kind,
         (${technicianServiceQualificationCondition({
           technicianIdExpr: 'tp.id',
           serviceIdExpr: 'svc.id',
           categoryIdExpr: 'svc.category_id',
         })}) AS approved_specialty,
         (${technicianCityCoverageCondition({
           technicianIdExpr: 'tp.id',
           requestedServiceZoneIdExpr: '$3',
         })}) AS same_city
       FROM technician_profiles tp
       JOIN services svc ON svc.id = $2
       WHERE tp.id = $1 AND tp.deleted_at IS NULL`,
      [technician.id, order.serviceId, order.serviceZoneId],
    );
    if (!scope?.correct_kind) {
      throw new ApiException(ErrorCode.VAL_001, 'الشخص ده مش مسجل حاليًا كمساعد', HttpStatus.CONFLICT);
    }
    if (!scope.approved_specialty) {
      throw new ApiException(ErrorCode.VAL_001, 'المساعد ده مش معتمد في تخصص الخدمة دي', HttpStatus.CONFLICT);
    }
    if (!scope.same_city) {
      throw new ApiException(ErrorCode.VAL_001, 'المساعد ده خارج مدينة الطلب', HttpStatus.CONFLICT);
    }
    const alreadyAssistant = await this.teamMembers.findOne({
      where: { orderId, technicianId: technician.id, memberType: ASSISTANT_MEMBER_TYPE },
    });
    if (alreadyAssistant) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده معيّن كمساعد على الطلب ده بالفعل', HttpStatus.CONFLICT);
    }

    // ADR-0057 — كان هنا فحص BLOCKED بس، بحجة إن "التعيين الإداري قرار واعٍ". المالك صحّح ده
    // صراحة: نفس قاعدة `recruitMember()` بالحرف لازم تتطبق هنا — تعارض زمني صريح = رفض قاطع،
    // MEANINGFUL/HEAVY = فرصة تحتاج قبول الشخص نفسه (مش تحميل صامت حتى لو الفاعل أدمن)، BLOCKED
    // = رفض تمامًا. صفر استثناء لكون الفاعل أدمن.
    await this.assignmentGuard.assertScheduleAvailable(this.dataSource.manager, technician.id, order);

    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const [service] = await this.dataSource.query<{ estimated_duration_minutes: number | null }[]>(
      `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
      [order.serviceId],
    );
    const capacityTier = await classifyTechnicianCapacity(this.dataSource, {
      technicianId: technician.id,
      scheduledAt: order.scheduledAt,
      excludeOrderId: order.id,
      serviceDurationMinutes: service?.estimated_duration_minutes ?? 60,
      dailyCapacityMinutes: dailyCapacityMinutes,
    });
    if (capacityTier === 'BLOCKED') {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده حظر اليوم ده بنفسه — مينفعش يتعيّن حتى بتعيين إداري', HttpStatus.CONFLICT);
    }

    if (capacityTier !== 'LIGHT') {
      return this.offerCrewOpportunityInsteadOfSilentLoad(orderId, order, technician.id, capacityTier, 'assistant');
    }

    await this.teamMembers.save(
      this.teamMembers.create({
        orderId,
        technicianId: technician.id,
        roleLabel: 'مساعد',
        memberType: ASSISTANT_MEMBER_TYPE,
        addedByTechnicianId: null,
        addedByAdminUserId: adminUserId,
      }),
    );

    // إشعار الفني عبر حدث، مش نداء مباشر لـNotificationsService — راجع "لماذا الإشعارات عبر
    // أحداث" في assistant-matching/README.md، نفس الاتفاقية المتبعة في كل الموديول ده بالفعل
    // (ORDER_STATUS_CHANGED_EVENT/ORDER_REASSIGNED_EVENT).
    this.events.emit(
      ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT,
      new OrderAssistantAssignedManuallyEvent(order.id, technician.id),
    );

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.assistant_assigned_manually',
      entityType: 'order',
      entityId: order.id,
      newValues: { technician_id: technician.id, capacity_tier: capacityTier },
      meta,
    });

    return { status: 'assigned', order };
  }

  /**
   * ADR-0057 — نقطة مشتركة لتحويل تعيين إداري لفرصة تحتاج قبول، بدل تحميل صامت، لما القدرة
   * الاستيعابية MEANINGFUL/HEAVY. نفس آلية `OrderTeamService.recruitMember()` بالحرف
   * (`technician_work_opportunities`, context=`crew_recruit`) — نقطة قبول واحدة
   * (`acceptCrewOpportunity`) بغض النظر مين عرض الفرصة، قائد أو أدمن.
   */
  private async offerCrewOpportunityInsteadOfSilentLoad(
    orderId: string,
    order: Order,
    technicianId: string,
    tier: TechnicianCapacityTier,
    role: 'technician' | 'assistant',
  ): Promise<CrewAssignOutcome> {
    const opportunity = await this.workOpportunities.offerIfNotExists(this.dataSource.manager, orderId, technicianId, tier, 'crew_recruit', role);
    if (opportunity.created) {
      this.events.emit(
        WORK_OPPORTUNITY_OFFERED_EVENT,
        new WorkOpportunityOfferedEvent(opportunity.id, orderId, order.orderNumber, technicianId, 'crew_recruit', tier, order.scheduledAt),
      );
    }
    return { status: 'offer_sent', opportunityId: opportunity.id, capacityTier: tier };
  }

  // ── إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41) ────────────────────────
  // كانت فجوة موثّقة صراحة: OrderTeamService.addMember()/removeMember() مقصورين على الفني
  // القائد بس (technician-leader-ownership-gated)، assignAssistant() فوق مقصور على شغل
  // "مساعد" بس. صلاحية مخصصة (orders.manage_crew، migration 0132) — عملية تشغيلية يومية
  // زي orders.assign_assistant، مش قرار super_admin بس.

  /**
   * ADR-0057 — كانت BLOCKED بس المرفوضة، وMEANINGFUL/HEAVY بتعدّي بحجة "الأدمن بيقرر بوعي".
   * المالك صحّح الاستثناء ده صراحة: نفس قاعدة `recruitMember()` بالحرف، صفر فرق لكون الفاعل
   * أدمن. `assertScheduleAvailable` هنا حارس صارم زيه بالظبط في المسار الذاتي.
   */
  private async validateCrewCandidateOrThrow(order: Order, technicianProfileId: string): Promise<TechnicianCapacityTier> {
    if (order.bookingMode !== BookingMode.TEAM) {
      throw new ApiException(ErrorCode.VAL_001, 'إدارة طاقم الفريق متاحة بس لطلبات "اعتماد" (فريق)', HttpStatus.BAD_REQUEST);
    }
    const technician = await this.techniciansService.findByProfileIdOrThrow(technicianProfileId);
    if (technician.verificationStatus !== TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.TECH_001, 'الفني ده لسه مش معتمد', HttpStatus.BAD_REQUEST);
    }
    if (order.technicianId === technician.id) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده هو قائد الطلب بالفعل', HttpStatus.CONFLICT);
    }
    const alreadyMember = await this.teamMembers.findOne({ where: { orderId: order.id, technicianId: technician.id } });
    if (alreadyMember) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده مضاف بالفعل لفريق الطلب ده', HttpStatus.CONFLICT);
    }

    await this.assignmentGuard.assertScheduleAvailable(this.dataSource.manager, technician.id, order);

    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const [service] = await this.dataSource.query<{ estimated_duration_minutes: number | null }[]>(
      `SELECT estimated_duration_minutes FROM services WHERE id = $1`,
      [order.serviceId],
    );
    const tier = await classifyTechnicianCapacity(this.dataSource, {
      technicianId: technician.id,
      scheduledAt: order.scheduledAt,
      excludeOrderId: order.id,
      serviceDurationMinutes: service?.estimated_duration_minutes ?? 60,
      dailyCapacityMinutes: dailyCapacityMinutes,
    });
    if (tier === 'BLOCKED') {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده حظر اليوم ده بنفسه — مينفعش يتجنّد حتى بتعيين إداري', HttpStatus.CONFLICT);
    }
    return tier;
  }

  /** إضافة عضو طاقم (Ops حل نقص طاقم، مش شغل "مساعد" بالضرورة — راجع assignAssistant فوق للمساعد تحديدًا). */
  /**
   * docs/08 §70 (بلاغ مالك) — `memberType` بقى صريح. قبل كده الصف كان بينزل بالافتراضي
   * `team_member` مهما كان الدور المكتوب، فالأدمن ماكانش يقدر يسدّ نقص المساعدين خالص:
   * `crew_status.assignedAssistants` تفضل صفر و"الطاقم ناقص" تفضل مزمّرة للأبد.
   */
  async addCrewMember(
    adminUserId: string,
    orderId: string,
    technicianId: string,
    roleLabel: string,
    memberType: CrewMemberType = 'team_member',
    meta?: AuditActorMeta,
  ): Promise<CrewAssignOutcome> {
    const order = await this.findOrThrow(orderId);
    const capacityTier = await this.validateCrewCandidateOrThrow(order, technicianId);
    // ADR-0050 — حتى الأدمن ما يقدرش يضيف مساعد بنصيب عضو فريق كامل: الدور صفة على الشخص،
    // والنسبة بتتبعه. لو الأدمن عايز يديه نصيب كامل، الطريق الصح إنه يرقّيه لفني في بروفايله.
    const candidateProfile = await this.techniciansService.findByProfileIdOrThrow(technicianId);
    const effectiveMemberType = resolveEffectiveMemberType(memberType, candidateProfile.technicianKind);
    if (order.orderType === OrderType.REVISIT && effectiveMemberType === ASSISTANT_MEMBER_TYPE) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'إعادة الزيارة المجانية لا تقبل مساعدًا بلا أجر — أنشئ دعمًا مدفوعًا مستقلًا لو مطلوب',
        HttpStatus.CONFLICT,
      );
    }

    const existingCount = await this.teamMembers.count({ where: { orderId } });
    if (existingCount >= MAX_TEAM_MEMBERS_PER_ORDER) {
      throw new ApiException(ErrorCode.VAL_001, `أقصى عدد أعضاء فريق للطلب هو ${MAX_TEAM_MEMBERS_PER_ORDER}`, HttpStatus.BAD_REQUEST);
    }

    // ADR-0057 — زي assignAssistant بالحرف: LIGHT بس هو اللي بيتضاف فورًا، MEANINGFUL/HEAVY
    // بتتحول لفرصة تحتاج قبول الشخص نفسه.
    if (capacityTier !== 'LIGHT') {
      return this.offerCrewOpportunityInsteadOfSilentLoad(
        orderId,
        order,
        technicianId,
        capacityTier,
        effectiveMemberType === ASSISTANT_MEMBER_TYPE ? 'assistant' : 'technician',
      );
    }

    // Script 4 Part Q — سباق حقيقي ممكن: أدمنين اتنين بيضيفوا نفس الفني لنفس الطلب بالتوازي
    // بالظبط، الفحص فوق (validateCrewCandidateOrThrow) مش ذرّي. الـUNIQUE constraint في الداتابيز
    // (order_id, technician_id، migration 0060) هو خط الدفاع الأخير اللي بيمنع صف مكرر فعليًا —
    // هنا بس بنحوّل خطأ الداتابيز الخام لنفس رسالة 409 الواضحة اللي الفحص العادي بيرجّعها.
    try {
      await this.teamMembers.save(
        this.teamMembers.create({
          orderId,
          technicianId,
          roleLabel,
          memberType: effectiveMemberType,
          addedByTechnicianId: null,
          addedByAdminUserId: adminUserId,
        }),
      );
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ApiException(ErrorCode.VAL_001, 'الفني ده مضاف بالفعل لفريق الطلب ده', HttpStatus.CONFLICT);
      }
      throw err;
    }

    this.events.emit(ORDER_CREW_CHANGED_EVENT, new OrderCrewChangedEvent(orderId, 'added', technicianId, null));
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.crew_member_added',
      entityType: 'order',
      entityId: orderId,
      newValues: { technician_id: technicianId, role_label: roleLabel, member_type: memberType, capacity_tier: capacityTier },
      meta,
    });
    return { status: 'assigned', order };
  }

  /** إزالة عضو طاقم — سبب إلزامي (Script 4 §38-41: "require appropriate state, reason, authorization"). */
  async removeCrewMember(adminUserId: string, orderId: string, memberId: string, reason: string, meta?: AuditActorMeta): Promise<{ crewShortage: boolean }> {
    const order = await this.findOrThrow(orderId);
    const member = await this.teamMembers.findOne({ where: { id: memberId, orderId } });
    if (!member) {
      throw new ApiException(ErrorCode.VAL_001, 'عضو الفريق ده غير موجود', HttpStatus.NOT_FOUND);
    }
    await this.teamMembers.remove(member);

    this.events.emit(ORDER_CREW_CHANGED_EVENT, new OrderCrewChangedEvent(orderId, 'removed', null, member.technicianId));
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.crew_member_removed',
      entityType: 'order',
      entityId: orderId,
      oldValues: { technician_id: member.technicianId, role_label: member.roleLabel, member_type: member.memberType },
      newValues: { reason },
      meta,
    });

    // جاهزية الطاقم (Script 4 §22-29: "don't silently show ready" لو الطاقم نقص) — منطق مشترك مع
    // OrderTeamService.getCrewComposition() (docs/08 §35، ADR-0021 §1) — فني/مساعد منفصلين دلوقتي،
    // مش عدّاد كلي زي computeCrewShortage() القديمة.
    const rows = await this.teamMembers.manager.query<{ member_type: string; count: string }[]>(
      `SELECT member_type, COUNT(*) AS count FROM order_team_members WHERE order_id = $1 GROUP BY member_type`,
      [orderId],
    );
    const technicians = Number(rows.find((r) => r.member_type === 'team_member')?.count ?? 0);
    const assistants = Number(rows.find((r) => r.member_type === 'assistant')?.count ?? 0);
    const composition = computeCrewComposition(order.requiredTechnicians, order.requiredAssistants, { technicians, assistants });
    return { crewShortage: !composition.crewComplete };
  }

  /**
   * استبدال عضو طاقم كـworkflow واحد متماسك (Script 4 §38-41): قفل → تحقق قديم → تحقق جديد →
   * إغلاق القديم وفتح الجديد ذرّيًا → تدقيق واحد بربط العضوين → إشعار الاتنين. ترانزاكشن واحدة
   * عشان مفيش نافذة زمنية يفضل فيها الطلب من غير العضو ده خالص (لا القديم ولا الجديد).
   */
  async replaceCrewMember(
    adminUserId: string,
    orderId: string,
    memberId: string,
    newTechnicianId: string,
    reason: string,
    roleLabelOverride: string | undefined,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const order = await this.findOrThrow(orderId);
    const existingMember = await this.teamMembers.findOne({ where: { id: memberId, orderId } });
    if (!existingMember) {
      throw new ApiException(ErrorCode.VAL_001, 'عضو الفريق ده غير موجود', HttpStatus.NOT_FOUND);
    }
    if (newTechnicianId === existingMember.technicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني الجديد نفس الفني القديم', HttpStatus.BAD_REQUEST);
    }
    const capacityTier = await this.validateCrewCandidateOrThrow(order, newTechnicianId);

    const oldMember = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderTeamMember);
      // إعادة قراءة جوّه الترانزاكشن (مش الاعتماد على existingMember المقروء فوق) — يحمي من
      // سباق حذف/استبدال متزامن على نفس العضو بين التحقق فوق والتنفيذ هنا.
      const existing = await repo.findOne({ where: { id: memberId, orderId } });
      if (!existing) {
        throw new ApiException(ErrorCode.VAL_001, 'عضو الفريق ده غير موجود (اتشال قبل كده)', HttpStatus.NOT_FOUND);
      }
      const roleLabel = roleLabelOverride ?? existing.roleLabel;
      // docs/08 §70 — نوع العضو بيتوارث من اللي اتشال: استبدال مساعد بيدّي مساعد، مش فني.
      // من غير ده كان الاستبدال بيرجع للافتراضي (`team_member`) ويقلب حسبة نقص المساعدين.
      const memberType = existing.memberType;
      await repo.remove(existing);
      // نفس حماية addCrewMember فوق — سباق ممكن: الفني الجديد بقى عضو بالفعل (إضافة متزامنة)
      // بين التحقق فوق (validateCrewCandidateOrThrow) وهنا.
      try {
        await repo.save(
          repo.create({ orderId, technicianId: newTechnicianId, roleLabel, memberType, addedByTechnicianId: null, addedByAdminUserId: adminUserId }),
        );
      } catch (err) {
        if (this.isUniqueViolation(err)) {
          throw new ApiException(ErrorCode.VAL_001, 'الفني الجديد بقى عضو في فريق الطلب بالفعل (سباق تعديل متزامن)', HttpStatus.CONFLICT);
        }
        throw err;
      }
      return existing;
    });

    this.events.emit(ORDER_CREW_CHANGED_EVENT, new OrderCrewChangedEvent(orderId, 'replaced', newTechnicianId, oldMember.technicianId));
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.crew_member_replaced',
      entityType: 'order',
      entityId: orderId,
      oldValues: { technician_id: oldMember.technicianId, role_label: oldMember.roleLabel },
      newValues: { technician_id: newTechnicianId, reason, capacity_tier: capacityTier },
      meta,
    });
    return order;
  }

  /**
   * تغيير قائد الطلب (docs/08 §35، ADR-0021 §5) — كانت فجوة حقيقية: `reassign()` فوق مقصورة على
   * `REASSIGNABLE_STATUSES` (قبل أي فني يقبل الطلب أصلاً) ومصمّمة أصلاً لطلب فردي (فني واحد بلا
   * طاقم) — مش تقدر تُستخدم لتغيير قائد طلب فريق **بعد** ما القبول حصل وطاقم اتجمّع بالفعل. القائد
   * الجديد بيتفحص بنفس صرامة `assignmentGuard.assertEligible()` (نفس المستخدمة في `reassign()`
   * ومسار قبول الفني الذاتي — صفر خوارزمية موازية). القائد القديم بيتحوّل لعضو فريق عادي (بدل ما
   * يختفي من الطلب فجأة) — "order/team state remains coherent" (طلب مالك صريح، سيناريو I).
   */
  async reassignLeader(
    adminUserId: string,
    orderId: string,
    newLeaderTechnicianId: string,
    reason: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const snapshot = await this.findOrThrow(orderId);
    if (snapshot.bookingMode !== BookingMode.TEAM) {
      throw new ApiException(ErrorCode.VAL_001, 'تغيير القائد متاح بس لطلبات "اعتماد" (فريق)', HttpStatus.BAD_REQUEST);
    }
    if (PRICE_LOCKED_STATUSES.has(snapshot.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تغيّر القائد والطلب في حالة ${snapshot.orderStatus} — الطلب اتقفل بالفعل`,
        HttpStatus.CONFLICT,
      );
    }
    if (snapshot.technicianId === newLeaderTechnicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده هو القائد بالفعل', HttpStatus.CONFLICT);
    }
    // القائد الأصلي وقت الطلب — مصدر التحقق من التزامن جوّه الترانزاكشن تحت. بعكس reassign()
    // العادية (بتعتمد على انتقال حالة الطلب لاستبعاد سباق تاني)، تغيير القائد هنا مايغيّرش حالة
    // الطلب خالص — بَقّة حقيقية اتلقطت حية (اختبار سباق: أدمنين بيغيّروا لفنيين مختلفين بالتوازي
    // كانوا الاتنين بينجحوا لأن الفحص القديم كان بس "الفني ده مش القائد الحالي بالفعل"، مش "القائد
    // اللي انبنى عليه القرار لسه هو نفسه" — لازم إعادة فحص القائد المتوقّع تحت القفل صراحة.
    const expectedPreviousLeaderId = snapshot.technicianId;

    const result = await this.dataSource.transaction(async (manager) => {
      const lockedTechnician = await this.assignmentGuard.lockTechnician(manager, newLeaderTechnicianId);
      const order = await manager
        .createQueryBuilder(Order, 'order')
        .setLock('pessimistic_write')
        .where('order.id = :orderId', { orderId })
        .getOne();
      if (!order || order.technicianId !== expectedPreviousLeaderId) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب اتغيّر (القائد اتبدّل من مكان تاني) — رجّع الصفحة وحاول تاني', HttpStatus.CONFLICT);
      }
      if (PRICE_LOCKED_STATUSES.has(order.orderStatus)) {
        throw new ApiException(ErrorCode.ORDR_003, 'الطلب اتقفل قبل ما التغيير يخلص', HttpStatus.CONFLICT);
      }
      await this.assignmentGuard.assertEligible(manager, lockedTechnician, order);

      const previousLeaderId = order.technicianId;
      const teamMemberRepo = manager.getRepository(OrderTeamMember);

      // لو القائد الجديد كان عضو فريق بالفعل — بيتشال من العضوية (بقى قائد دلوقتي، مش عضو تحت نفسه).
      const existingMembership = await teamMemberRepo.findOne({ where: { orderId: order.id, technicianId: lockedTechnician.id } });
      if (existingMembership) {
        await teamMemberRepo.remove(existingMembership);
      }

      order.technicianId = lockedTechnician.id;
      await manager.save(order);

      if (previousLeaderId) {
        const alreadyMemberAsOldLeader = await teamMemberRepo.findOne({ where: { orderId: order.id, technicianId: previousLeaderId } });
        if (!alreadyMemberAsOldLeader) {
          await teamMemberRepo.save(
            teamMemberRepo.create({
              orderId: order.id,
              technicianId: previousLeaderId,
              roleLabel: 'قائد سابق',
              addedByTechnicianId: null,
              addedByAdminUserId: adminUserId,
            }),
          );
        }
      }
      return { order, previousLeaderId };
    });

    this.events.emit(
      ORDER_REASSIGNED_EVENT,
      new OrderReassignedEvent(result.order.id, result.order.orderNumber, result.order.technicianId!),
    );
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.leader_reassigned',
      entityType: 'order',
      entityId: orderId,
      oldValues: { technician_id: result.previousLeaderId },
      newValues: { technician_id: result.order.technicianId, reason },
      meta,
    });
    return result.order;
  }

  // نفس نمط RatingsService.isUniqueViolation() بالحرف — خطأ Postgres الخام (23505) بيتحوّل
  // لرسالة 409 واضحة بدل ما يتسرّب كـ500 عام.
  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
  }
}
