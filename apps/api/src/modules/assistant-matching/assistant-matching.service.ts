import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import {
  technicianAvailabilityCondition,
  technicianCityCoverageCondition,
  technicianKindCondition,
  technicianServiceQualificationCondition,
} from '../technicians/technician-eligibility.sql';
import { resolveDailyCapacityMinutes } from '../technicians/technician-day-capacity.sql';
import {
  ASSISTANT_MATCHING_ESCALATED_EVENT,
  AssistantMatchingEscalatedEvent,
} from '../../common/events/assistant-matching-escalated.event';
import {
  ASSISTANT_OPPORTUNITY_OFFERED_EVENT,
  AssistantOpportunityOfferedEvent,
} from '../../common/events/assistant-opportunity-offered.event';
import {
  ASSISTANT_PERSONAL_ASSIGNED_EVENT,
  AssistantPersonalAssignedEvent,
} from '../../common/events/assistant-personal-assigned.event';
import { BookingMode, Order } from '../orders/entities/order.entity';
import { OrderTeamMember } from '../orders/entities/order-team-member.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { SettingsService } from '../settings/settings.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianAssistantLinkStatus } from '../technicians/entities/technician-profile.entity';
import {
  ASSISTANT_MATCHING_QUEUE,
  ASSISTANT_OFFERS_EXPIRED_JOB,
  AssistantOffersExpiredJobData,
  assistantOffersExpiredJobId,
} from './assistant-matching.queue';
import { AssistantOfferListRow } from './dto/assistant-offer-response.dto';
import { AssistantOfferStatus, OrderAssistantOffer } from './entities/order-assistant-offer.entity';

const BATCH_SIZE_FALLBACK = 10;
const RESPONSE_TIMEOUT_SECONDS_FALLBACK = 120;

interface EligibleAssistantRow {
  technician_id: string;
}

const MEMBER_TYPE_ASSISTANT = 'assistant';

/**
 * **مصدر أعمدة الحمل التشغيلي للطلب المرشّح** (ADR-0061 §2) — الطلب معروف بـuuid، فأعمدته
 * بتتقرا منه مباشرة والقاعدة الموحّدة هي اللي بتحوّلها لدقايق/يوم.
 */
function assistantCandidateLoad(orderIdParam: string, serviceAlias: string) {
  return {
    estimatedDurationDaysExpr: `(SELECT o3.estimated_duration_days FROM orders o3 WHERE o3.id = ${orderIdParam}::uuid)`,
    durationMinutesExpr: `(SELECT COALESCE(o2.duration_minutes, o2.duration_hours * 60) FROM orders o2 WHERE o2.id = ${orderIdParam}::uuid)`,
    serviceDefaultMinutesExpr: `${serviceAlias}.estimated_duration_minutes`,
  };
}

/** مدة الطلب المرشّح بالدقايق — نفس ترتيب المصادر المستخدم في matching.service.ts بالحرف. */
function assistantServiceDurationExpr(orderIdParam: string, serviceAlias: string): string {
  return `COALESCE((SELECT COALESCE(o2.duration_minutes, o2.duration_hours * 60) FROM orders o2 WHERE o2.id = ${orderIdParam}::uuid), COALESCE(${serviceAlias}.estimated_duration_minutes, 60), 60)`;
}


/**
 * مطابقة المساعد التلقائية (ADR-0007) — أولوية 1 (المساعد الشخصي) ثم أولوية 2 (بث لمجمع
 * المساعدين المؤهلين، أول قبول صحيح ياخد الشريحة). تفاصيل التصميم الكاملة والبدائل اللي
 * اتقيّمت في docs/adr/0007-assistant-pool-matching.md.
 */
@Injectable()
export class AssistantMatchingService {
  private readonly logger = new Logger(AssistantMatchingService.name);

  constructor(
    @InjectRepository(OrderAssistantOffer) private readonly offers: Repository<OrderAssistantOffer>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderTeamMember) private readonly teamMembers: Repository<OrderTeamMember>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly techniciansService: TechniciansService,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
    @InjectQueue(ASSISTANT_MATCHING_QUEUE) private readonly queue: Queue<AssistantOffersExpiredJobData>,
  ) {}

  private async filledSlotsCount(orderId: string): Promise<number> {
    return this.teamMembers.count({ where: { orderId, memberType: MEMBER_TYPE_ASSISTANT } });
  }

  /**
   * فحص أهلية أساسي مشترك بين أولوية 1 وأولوية 2.
   *
   * **ADR-0061 §3 — شرط التوافر هنا بقى `technicianAvailabilityCondition()` نفسها**، مش نسخة
   * موازية. التعليق القديم كان بيقول «نفس منطق findEligibleTechnicians() بالحرف»، والحقيقة إنه
   * كان **منطق تاني خالص** انجرف عنه بتلات فروق حقيقية:
   *
   * 1. أي طلب نشط للمساعد — **في أي يوم، مهما كان قصير** — كان بيستبعده تمامًا. دي بالظبط بَقّة
   *    ADR-0018 §32 اللي اتصلحت للفني القائد من تسعة شهور وفضلت عايشة هنا: المساعد اللي عنده
   *    شغلانة ساعتين الأسبوع الجاي كان «مش موجود» لكل عروض النهاردة.
   * 2. السقف اليومي بالدقايق (ADR-0059) ماكانش بيتطبّق عليه خالص — فمساعد يومه مليان 12 ساعة
   *    ومساعد فاضي كانوا **نفس الشيء** لو الاتنين مالهمش طلب نشط.
   * 3. كان بيفحص `technician_schedule_slots.status = 'booked'` بدل `'blocked'` — يعني **إجازة
   *    المساعد الصريحة ماكانتش بتتقرا أصلاً**. مساعد حاجز يوم لنفسه كان لسه بياخد عروض فيه.
   *
   * وكمان `($4::timestamptz)::date` كانت بتتحسب بتوقيت جلسة Postgres (UTC) بدل توقيت مصر — نفس
   * غلطة اليوم-الأسبق اللي ADR-0018 قفلها في المحرك المشترك.
   */
  private async isCandidateEligible(technicianId: string, order: Order, manager?: EntityManager): Promise<boolean> {
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const [row] = await (manager ?? this.dataSource).query<{ eligible: boolean }[]>(
      `
      SELECT EXISTS (
        SELECT 1 FROM technician_profiles tp, services s
        WHERE tp.id = $1 AND s.id = $3
        AND tp.verification_status = 'approved'
        AND tp.deleted_at IS NULL
        -- ADR-0050 — الاتجاه العكسي: المسار ده بيدوّر على **مساعد**، فالفنيين مستبعدين منه.
        AND ${technicianKindCondition({ technicianAlias: 'tp', kind: 'assistant' })}
        AND ${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 's.id',
          categoryIdExpr: 's.category_id',
        })}
        AND ${technicianCityCoverageCondition({
          technicianIdExpr: 'tp.id',
          requestedServiceZoneIdExpr: '$5',
        })}
        AND tp.current_location IS NOT NULL
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$4',
          excludeOrderIdParam: '$9',
          activeStatusesParam: '$2',
          engagedStatusesParam: '$6',
          isEmergencyParam: '$7',
          serviceDurationExpr: assistantServiceDurationExpr('$9', 's'),
          candidateLoad: assistantCandidateLoad('$9', 's'),
          preciseDurationHoursExpr: '(SELECT COALESCE(o2.duration_minutes / 60.0, o2.duration_hours) FROM orders o2 WHERE o2.id = $9::uuid)',
          dailyCapacityMinutesParam: '$8',
        })}
      ) AS eligible
      `,
      [
        technicianId,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        order.serviceId,
        order.scheduledAt ?? null,
        order.serviceZoneId,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        order.bookingMode === BookingMode.EMERGENCY,
        dailyCapacityMinutes,
        order.id,
      ],
    );
    return row?.eligible === true;
  }

  /** لحظة قبول الفني القائد للطلب (ORDER_ACCEPTED_EVENT) — الأولى اللي نعرف فيها القائد أصلاً. */
  async startMatching(orderId: string): Promise<void> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order || !order.technicianId) return;
    if (!order.requiredAssistants || order.requiredAssistants <= 0) return; // required_assistants=0 — مفيش مطابقة خالص

    let filled = await this.filledSlotsCount(orderId);
    if (filled >= order.requiredAssistants) return;

    const lead = await this.techniciansService.findByProfileIdOrThrow(order.technicianId);

    // أولوية 1: المساعد الشخصي المعتمد
    if (lead.assistantLinkStatus === TechnicianAssistantLinkStatus.APPROVED && lead.assistantTechnicianId) {
      const eligible = await this.isCandidateEligible(lead.assistantTechnicianId, order);
      if (eligible) {
        const inserted = await this.teamMembers
          .createQueryBuilder()
          .insert()
          .values({
            orderId,
            technicianId: lead.assistantTechnicianId,
            roleLabel: 'مساعد',
            memberType: MEMBER_TYPE_ASSISTANT,
            addedByTechnicianId: lead.id,
          })
          .orIgnore()
          .returning(['id'])
          .execute();
        if (inserted.identifiers.length > 0) {
          filled += 1;
          this.logger.log(`مساعد شخصي اتعيّن مباشرة لطلب ${order.orderNumber} (أولوية 1)`);
          this.events.emit(
            ASSISTANT_PERSONAL_ASSIGNED_EVENT,
            new AssistantPersonalAssignedEvent(orderId, lead.assistantTechnicianId),
          );
        } else {
          filled = await this.filledSlotsCount(orderId);
        }
      }
    }

    const remaining = order.requiredAssistants - filled;
    if (remaining <= 0) return;

    const poolEnabled = await this.settingsService.getBoolean('assistant_matching.pool_matching_enabled', true);
    if (!poolEnabled) return;

    await this.broadcastToPool(order, lead.id, 1);
  }

  /**
   * أولوية 2: بث لمجمع المساعدين المؤهلين — نفس معايير أهلية الفني العادي لخدمة/منطقة الطلب.
   *
   * بترجّع **عدد العروض الجديدة اللي اتبعتت فعلاً** (ADR-0061 §4) — ده هو شرط استمرار الجولات:
   * جولة بترجّع صفر معناها المجمع خلص، وساعتها بس بيتصعّد للعمليات.
   */
  private async broadcastToPool(order: Order, leadTechnicianId: string, round: number): Promise<number> {
    if (!order.serviceZoneId) return 0;

    const alreadyOffered = await this.offers.find({ where: { orderId: order.id } });
    const excludeIds = [leadTechnicianId, ...alreadyOffered.map((o) => o.assistantTechnicianId)];

    const batchSize = await this.settingsService.getNumber('assistant_matching.batch_size', BATCH_SIZE_FALLBACK);
    const dailyCapacityMinutes = await resolveDailyCapacityMinutes(this.settingsService);
    const candidates = await this.dataSource.query<EligibleAssistantRow[]>(
      `
      SELECT tp.id AS technician_id
      FROM technician_profiles tp
      -- ADR-0018 §8 — LEFT JOIN بدل INNER: أهلية الفني بقت "خدمة معتمدة مباشرة OR فئة الخدمة
      -- معتمدة" (شرط الـEXISTS تحت)، نفس القاعدة في matching.service.ts.
      LEFT JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN addresses a ON a.id = $3
      JOIN services s ON s.id = $1
      WHERE tp.verification_status = 'approved'
        -- ADR-0050 — الاتجاه العكسي: مجمع المساعدين بيضم المساعدين بس. قبل كده كان بيبث لأي فني
        -- مؤهّل، فالفنيين الكاملين كانوا بياخدوا عروض مساعدة بنسبة أقل من نصيبهم العادي.
        AND ${technicianKindCondition({ technicianAlias: 'tp', kind: 'assistant' })}
        -- المساعد لازم يكون معتمدًا على الخدمة نفسها أو فئتها، بالضبط مثل الفني. ده يمنع مساعد
        -- السباكة من استلام كهرباء لمجرد إن دوره في الطلب "مساعد".
        AND ${technicianServiceQualificationCondition({
          technicianIdExpr: 'tp.id',
          serviceIdExpr: 's.id',
          categoryIdExpr: 's.category_id',
          directServiceAlias: 'ts',
        })}
        -- نطاقات الأدمن تفتح المدينة كلها للمساعد، لا مدينة أخرى. المسافة تحت للترتيب فقط.
        AND ${technicianCityCoverageCondition({
          technicianIdExpr: 'tp.id',
          requestedServiceZoneIdExpr: '$2',
        })}
        AND tp.current_location IS NOT NULL
        AND tp.deleted_at IS NULL
        AND tp.id != ALL($6::uuid[])
        -- ADR-0061 §3 — نفس محرك التوافر بالظبط اللي بيقرر أهلية الفني القائد
        -- (technicianAvailabilityCondition)، مش نسخة موازية. الشرط ده بيغطّي التزام المساعد
        -- كقائد وكعضو طاقم مع بعض (committedOrdersSource)، والسقف اليومي بالدقايق (ADR-0059)،
        -- وإجازته الصريحة (blocked) — تلاتتهم ماكانوش موجودين في النسخة القديمة.
        ${technicianAvailabilityCondition({
          technicianIdExpr: 'tp.id',
          scheduledAtParam: '$7',
          excludeOrderIdParam: '$11',
          activeStatusesParam: '$5',
          engagedStatusesParam: '$8',
          isEmergencyParam: '$9',
          serviceDurationExpr: assistantServiceDurationExpr('$11', 's'),
          candidateLoad: assistantCandidateLoad('$11', 's'),
          preciseDurationHoursExpr: '(SELECT COALESCE(o2.duration_minutes / 60.0, o2.duration_hours) FROM orders o2 WHERE o2.id = $11::uuid)',
          dailyCapacityMinutesParam: '$10',
        })}
      ORDER BY ST_Distance(tp.current_location, a.location) ASC,
               CASE tp.current_level
                 WHEN 'team_leader' THEN 4 WHEN 'premium' THEN 3 WHEN 'professional' THEN 2
                 WHEN 'verified' THEN 1 ELSE 0
               END DESC,
               tp.average_rating DESC
      LIMIT $4
      `,
      [
        order.serviceId,
        order.serviceZoneId,
        order.addressId,
        batchSize,
        ACTIVE_TECHNICIAN_ORDER_STATUSES,
        excludeIds,
        order.scheduledAt ?? null,
        ENGAGED_TECHNICIAN_ORDER_STATUSES,
        order.bookingMode === BookingMode.EMERGENCY,
        dailyCapacityMinutes,
        order.id,
      ],
    );

    if (candidates.length === 0) {
      this.logger.warn(
        `مفيش مساعدين مؤهلين جدد لطلب ${order.orderNumber} في الجولة ${round} — المجمع خلص`,
      );
      return 0;
    }

    const responseTimeoutSeconds = await this.settingsService.getNumber(
      'assistant_matching.response_timeout_seconds',
      RESPONSE_TIMEOUT_SECONDS_FALLBACK,
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + responseTimeoutSeconds * 1000);

    let sent = 0;
    for (const c of candidates) {
      const inserted = await this.offers
        .createQueryBuilder()
        .insert()
        .values({
          orderId: order.id,
          assistantTechnicianId: c.technician_id,
          offerStatus: AssistantOfferStatus.SENT,
          sentAt: now,
          expiresAt,
          matchingRound: round,
        })
        .orIgnore()
        .returning(['id'])
        .execute();
      const offerId = (inserted.raw as Array<{ id: string }>)[0]?.id;
      if (offerId) {
        sent += 1;
        this.events.emit(
          ASSISTANT_OPPORTUNITY_OFFERED_EVENT,
          new AssistantOpportunityOfferedEvent(offerId, order.id, c.technician_id, order.orderNumber),
        );
      }
    }

    // مفيش عرض جديد اتكتب فعلاً (كلهم اتسبقوا بـorIgnore) — نفس معنى «المجمع خلص» بالظبط،
    // وبلا مؤقّت جديد عشان مانستنّاش مهلة كاملة على لا شيء.
    if (sent === 0) return 0;

    await this.queue.add(
      ASSISTANT_OFFERS_EXPIRED_JOB,
      { orderId: order.id },
      { delay: responseTimeoutSeconds * 1000, jobId: assistantOffersExpiredJobId(order.id, round) },
    );
    return sent;
  }

  /** آخر جولة بث اتبعتت للطلب — 0 لو لسه مفيش أي بث. */
  private async currentRound(orderId: string): Promise<number> {
    const [row] = await this.dataSource.query<{ round: number }[]>(
      `SELECT COALESCE(MAX(matching_round), 0)::int AS round FROM order_assistant_offers WHERE order_id = $1`,
      [orderId],
    );
    return row?.round ?? 0;
  }

  async listAvailableForTechnician(userId: string): Promise<AssistantOfferListRow[]> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    return this.dataSource.query<AssistantOfferListRow[]>(
      `
      SELECT oao.id AS "offerId", o.id AS "orderId", o.order_number AS "orderNumber", s.name_ar AS "serviceNameAr",
             o.problem_description AS "problemDescription", a.street_name AS "streetName", a.landmark AS "landmark",
             oao.expires_at AS "expiresAt"
      FROM order_assistant_offers oao
      JOIN orders o ON o.id = oao.order_id
      JOIN services s ON s.id = o.service_id
      JOIN addresses a ON a.id = o.address_id
      WHERE oao.assistant_technician_id = $1 AND oao.offer_status = 'sent' AND oao.expires_at > now()
      ORDER BY oao.sent_at DESC
      `,
      [profile.id],
    );
  }

  /** بيتأكد الطلب/المساعد موجودين وبيرجّع orderId بلا أي فحص حالة — الفحص الحقيقي بيحصل بعد القفل. */
  private async findOwnedOfferOrThrow(userId: string, offerId: string): Promise<{ profileId: string; orderId: string }> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const offer = await this.offers.findOne({ where: { id: offerId, assistantTechnicianId: profile.id } });
    if (!offer) {
      throw new ApiException(ErrorCode.VAL_001, 'عرض المساعدة ده مش موجود ليك', HttpStatus.NOT_FOUND);
    }
    return { profileId: profile.id, orderId: offer.orderId };
  }

  /**
   * أول قبول صحيح ياخد الشريحة — قفل ذرّي (SELECT...FOR UPDATE) على صف الطلب نفسه (المورد
   * المشترك الفعلي: عدد الشرائح المتاحة)، نفس نمط MatchingService.accept() بالحرف. **فحص حالة
   * العرض نفسه بيتأجّل لحد بعد القفل عمداً** — لو ده مش موجود، ضغطتين متزامنتين على نفس العرض
   * (أو قبول واتنين مختلفين على نفس الطلب) ممكن يعدّوا الفحص الأول قبل ما أي حد يمسك القفل،
   * ويعملوا صفين order_team_members مكررين لنفس المساعد. القفل على صف orders بيسلسل **كل**
   * التعديلات (قبول/رفض) على عروض الطلب ده، مش بس قراءة عدد الشرائح.
   */
  async accept(userId: string, offerId: string): Promise<void> {
    const { profileId, orderId } = await this.findOwnedOfferOrThrow(userId, offerId);

    await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }

      // إعادة قراءة العرض *بعد* القفل — أي تعديل حصل عليه من محاولة متزامنة اتسلسلت قبلنا هيبان هنا.
      const offer = await manager.findOne(OrderAssistantOffer, { where: { id: offerId } });
      if (!offer || offer.offerStatus !== AssistantOfferStatus.SENT || offer.expiresAt.getTime() < Date.now()) {
        throw new ApiException(ErrorCode.ORDR_003, 'الفرصة دي مبقتش متاحة', HttpStatus.CONFLICT);
      }

      const filled = await manager.count(OrderTeamMember, { where: { orderId: order.id, memberType: MEMBER_TYPE_ASSISTANT } });
      if (filled >= (order.requiredAssistants ?? 0)) {
        offer.offerStatus = AssistantOfferStatus.SLOT_FILLED;
        offer.respondedAt = new Date();
        await manager.save(offer);
        throw new ApiException(ErrorCode.ORDR_003, 'الأماكن المطلوبة اكتملت بالفعل — حد تاني كسب السباق', HttpStatus.CONFLICT);
      }

      // العرض ممكن يفضل مفتوح لثوانٍ بعد سحب اعتماد التخصص أو تغيير مناطق المساعد. إعادة الفحص
      // تحت قفل الطلب تمنع قبول عرض قديم لم يعد صالحًا، وتخلي قرار القبول مطابقًا لقرار العرض.
      if (!(await this.isCandidateEligible(profileId, order, manager))) {
        throw new ApiException(ErrorCode.ORDR_003, 'لم تعد مؤهلًا لتخصص أو مدينة أو موعد الطلب ده', HttpStatus.CONFLICT);
      }

      const now = new Date();
      offer.offerStatus = AssistantOfferStatus.ACCEPTED;
      offer.respondedAt = now;
      await manager.save(offer);

      await manager.save(
        manager.create(OrderTeamMember, {
          orderId: order.id,
          technicianId: profileId,
          roleLabel: 'مساعد',
          memberType: MEMBER_TYPE_ASSISTANT,
          addedByTechnicianId: order.technicianId!,
        }),
      );

      if (filled + 1 >= (order.requiredAssistants ?? 0)) {
        await manager.update(
          OrderAssistantOffer,
          { orderId: order.id, offerStatus: AssistantOfferStatus.SENT },
          { offerStatus: AssistantOfferStatus.SLOT_FILLED, respondedAt: now },
        );
        await this.queue.remove(assistantOffersExpiredJobId(order.id, offer.matchingRound));
        this.logger.log(`كل شرائح المساعد اكتملت لطلب ${order.orderNumber} — قفل البث`);
      }
    });
  }

  /** نفس فلسفة القفل في accept() — لو حصل سباق بين رفض وقبول لنفس العرض، الاتنين بيتسلسلوا صح. */
  async reject(userId: string, offerId: string): Promise<void> {
    const { orderId } = await this.findOwnedOfferOrThrow(userId, offerId);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();

      const offer = await manager.findOne(OrderAssistantOffer, { where: { id: offerId } });
      if (!offer || offer.offerStatus !== AssistantOfferStatus.SENT) {
        throw new ApiException(ErrorCode.ORDR_003, 'الفرصة دي مبقتش متاحة', HttpStatus.CONFLICT);
      }
      offer.offerStatus = AssistantOfferStatus.REJECTED;
      offer.respondedAt = new Date();
      await manager.save(offer);
    });
  }

  /** بيتنادى من AssistantOfferExpiryProcessor لما مهلة البث تنتهي. */
  async handleExpiry(orderId: string): Promise<void> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) return;

    const staleOffers = await this.offers.find({ where: { orderId, offerStatus: AssistantOfferStatus.SENT } });
    if (staleOffers.length > 0) {
      const now = new Date();
      await this.offers.update(
        { id: In(staleOffers.map((o) => o.id)) },
        { offerStatus: AssistantOfferStatus.EXPIRED, respondedAt: now },
      );
    }

    const filled = await this.filledSlotsCount(orderId);
    const remaining = (order.requiredAssistants ?? 0) - filled;
    if (remaining <= 0) return;

    // ADR-0061 §4 — **جولة تانية (وتالتة، ورابعة…) قبل التصعيد**.
    //
    // قبل كده كان التصعيد بيحصل بعد الجولة الأولى على طول: أول دفعة مرشّحين ماتردش ⇒ العمليات
    // بتتنده، حتى لو فيه عشرات المساعدين المؤهلين المتاحين **لسه ماتسألوش أصلاً**. ده تصعيد
    // كاذب — بيحوّل شغل الغطاء التلقائي لشغل يدوي بلا سبب حقيقي.
    //
    // الجولات بتنتهي بنفسها بلا أي سقف صناعي: كل مرشّح اتبعتله عرض بيتسجّل ويتستبعد من الدفعة
    // اللي بعدها (`excludeIds`)، فعدد الجولات محدود ببنيته بحجم المجمع. التصعيد بيحصل بس لما
    // جولة ترجّع صفر مرشّح جديد = المجمع خلص فعلاً.
    const poolEnabled = await this.settingsService.getBoolean('assistant_matching.pool_matching_enabled', true);
    if (poolEnabled && order.technicianId) {
      const nextRound = (await this.currentRound(orderId)) + 1;
      const sent = await this.broadcastToPool(order, order.technicianId, nextRound);
      if (sent > 0) {
        this.logger.log(
          `مهلة الجولة انتهت لطلب ${order.orderNumber} — اتبعتت جولة ${nextRound} لـ${sent} مساعد جديد بدل التصعيد`,
        );
        return;
      }
    }

    this.logger.warn(
      `مطابقة المساعد استنفدت المجمع لطلب ${order.orderNumber} — لسه ${remaining} شريحة فاضية، بيتصعّد للعمليات`,
    );
    this.events.emit(
      ASSISTANT_MATCHING_ESCALATED_EVENT,
      new AssistantMatchingEscalatedEvent(order.id, order.orderNumber, remaining),
    );
  }
}
