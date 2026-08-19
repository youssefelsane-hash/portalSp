import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { DataSource, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
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
import { Order } from '../orders/entities/order.entity';
import { OrderTeamMember } from '../orders/entities/order-team-member.entity';
import { ACTIVE_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
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
   * فحص أهلية أساسي مشترك بين أولوية 1 وأولوية 2 — نفس معايير findEligibleTechnicians في
   * matching.service.ts، بما فيها تعارض الجدولة (كانت فجوة موثّقة صراحة في ADR-0007 §7 —
   * "بالاكتفاء بفحص 'مفيش طلب نشط' نفس دقة الفني القائد" — اتقفلت 2026-08-13، نفس منطق
   * matching.service.ts's findEligibleTechnicians() بالحرف، راجع التعليق هناك للتفاصيل الكاملة).
   */
  private async isCandidateEligible(technicianId: string, order: Order): Promise<boolean> {
    const [row] = await this.dataSource.query<{ eligible: boolean }[]>(
      `
      SELECT (
        tp.verification_status = 'approved'
        AND tp.deleted_at IS NULL
        AND tp.id NOT IN (
          SELECT technician_id FROM orders
          WHERE technician_id IS NOT NULL AND order_status = ANY($2::order_status[]) AND deleted_at IS NULL
        )
        AND tp.id NOT IN (
          SELECT otm.technician_id FROM order_team_members otm
          JOIN orders o ON o.id = otm.order_id
          WHERE otm.member_type = 'assistant' AND o.order_status = ANY($2::order_status[]) AND o.deleted_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM technician_schedule_slots tss
          WHERE tss.technician_id = tp.id
            AND tss.status = 'booked'
            AND tss.deleted_at IS NULL
            AND $4::timestamptz IS NOT NULL
            AND tss.slot_date = ($4::timestamptz)::date
            AND tss.start_time < (($4::timestamptz + (COALESCE(s.estimated_duration_minutes, 60) || ' minutes')::interval))::time
            AND tss.end_time > ($4::timestamptz)::time
        )
      ) AS eligible
      FROM technician_profiles tp, services s
      WHERE tp.id = $1 AND s.id = $3
      `,
      [technicianId, ACTIVE_TECHNICIAN_ORDER_STATUSES, order.serviceId, order.scheduledAt ?? null],
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

    await this.broadcastToPool(order, lead.id);
  }

  /** أولوية 2: بث لمجمع المساعدين المؤهلين — نفس معايير أهلية الفني العادي لخدمة/منطقة الطلب. */
  private async broadcastToPool(order: Order, leadTechnicianId: string): Promise<void> {
    if (!order.serviceZoneId) return;

    const alreadyOffered = await this.offers.find({ where: { orderId: order.id } });
    const excludeIds = [leadTechnicianId, ...alreadyOffered.map((o) => o.assistantTechnicianId)];

    const batchSize = await this.settingsService.getNumber('assistant_matching.batch_size', BATCH_SIZE_FALLBACK);
    const candidates = await this.dataSource.query<EligibleAssistantRow[]>(
      `
      SELECT tp.id AS technician_id
      FROM technician_profiles tp
      JOIN technician_services ts ON ts.technician_id = tp.id AND ts.service_id = $1 AND ts.is_active = true
        AND ts.verification_status = 'approved'
      JOIN technician_zones tz ON tz.technician_id = tp.id AND tz.service_zone_id = $2 AND tz.is_active = true
      JOIN addresses a ON a.id = $3
      JOIN services s ON s.id = $1
      WHERE tp.verification_status = 'approved'
        AND tp.current_location IS NOT NULL
        AND tp.deleted_at IS NULL
        AND tp.id != ALL($6::uuid[])
        AND tp.id NOT IN (
          SELECT technician_id FROM orders
          WHERE technician_id IS NOT NULL AND order_status = ANY($5::order_status[]) AND deleted_at IS NULL
        )
        AND tp.id NOT IN (
          SELECT otm.technician_id FROM order_team_members otm
          JOIN orders o ON o.id = otm.order_id
          WHERE otm.member_type = 'assistant' AND o.order_status = ANY($5::order_status[]) AND o.deleted_at IS NULL
        )
        -- تعارض جدولة (ADR-0007 §7 — كانت فجوة موثّقة صراحة، اتقفلت) — نفس منطق
        -- matching.service.ts's findEligibleTechnicians() بالحرف بالنسبة للمساعد نفسه.
        AND NOT EXISTS (
          SELECT 1 FROM technician_schedule_slots tss
          WHERE tss.technician_id = tp.id
            AND tss.status = 'booked'
            AND tss.deleted_at IS NULL
            AND $7::timestamptz IS NOT NULL
            AND tss.slot_date = ($7::timestamptz)::date
            AND tss.start_time < (($7::timestamptz + (COALESCE(s.estimated_duration_minutes, 60) || ' minutes')::interval))::time
            AND tss.end_time > ($7::timestamptz)::time
        )
      ORDER BY ST_Distance(tp.current_location, a.location) ASC
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
      ],
    );

    if (candidates.length === 0) {
      this.logger.warn(`مفيش مساعدين مؤهلين متاحين لطلب ${order.orderNumber} — هيصعّد بعد المهلة لو محدش قبل`);
    }

    const responseTimeoutSeconds = await this.settingsService.getNumber(
      'assistant_matching.response_timeout_seconds',
      RESPONSE_TIMEOUT_SECONDS_FALLBACK,
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + responseTimeoutSeconds * 1000);

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
        })
        .orIgnore()
        .returning(['id'])
        .execute();
      const offerId = (inserted.raw as Array<{ id: string }>)[0]?.id;
      if (offerId) {
        this.events.emit(
          ASSISTANT_OPPORTUNITY_OFFERED_EVENT,
          new AssistantOpportunityOfferedEvent(offerId, order.id, c.technician_id),
        );
      }
    }

    await this.queue.add(
      ASSISTANT_OFFERS_EXPIRED_JOB,
      { orderId: order.id },
      { delay: responseTimeoutSeconds * 1000, jobId: assistantOffersExpiredJobId(order.id) },
    );
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
        await this.queue.remove(assistantOffersExpiredJobId(order.id));
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
    if (remaining > 0) {
      this.logger.warn(`مهلة مطابقة المساعد انتهت لطلب ${order.orderNumber} — لسه ${remaining} شريحة فاضية، بيتصعّد للعمليات`);
      this.events.emit(
        ASSISTANT_MATCHING_ESCALATED_EVENT,
        new AssistantMatchingEscalatedEvent(order.id, order.orderNumber, remaining),
      );
    }
  }
}
