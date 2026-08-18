import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Between, DataSource, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_REASSIGNED_EVENT, OrderReassignedEvent } from '../../common/events/order-reassigned.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import {
  ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT,
  OrderAssistantAssignedManuallyEvent,
} from '../../common/events/order-assistant-assigned-manually.event';
import { ORDER_CREW_CHANGED_EVENT, OrderCrewChangedEvent } from '../../common/events/order-crew-changed.event';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';
import { TechniciansService } from '../technicians/technicians.service';
import { AssignmentStatus, OrderAssignment } from '../matching/entities/order-assignment.entity';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { MAX_TEAM_MEMBERS_PER_ORDER } from './order-team.service';
import { BookingMode, Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderTeamMember } from './entities/order-team-member.entity';
import { OrderTimelineEventRow } from './dto/order-timeline-event-response.dto';
import { TechnicianOrderCancellation } from './entities/technician-order-cancellation.entity';
import { canTransition } from './order-state-machine';

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
  ) {}

  async list(
    query: ListOrdersQueryDto,
  ): Promise<{ items: Order[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const where: FindOptionsWhere<Order> = {};
    if (query.order_status) where.orderStatus = query.order_status;
    if (query.from && query.to) {
      where.placedAt = Between(new Date(query.from), new Date(query.to));
    } else if (query.from) {
      where.placedAt = MoreThanOrEqual(new Date(query.from));
    } else if (query.to) {
      where.placedAt = LessThanOrEqual(new Date(query.to));
    }

    const [items, total] = await this.orders.findAndCount({
      where,
      order: { placedAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return { items, meta: { page, per_page: perPage, total } };
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
    return { order, history, pricingEvaluation, technicianCancellations };
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
      ),
    );

    return cancelledOrder;
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

      const previousTotal = order.totalAmountCents;
      order.totalAmountCents = newTotalAmountCents;
      await manager.save(order);
      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'order.price_adjusted_by_admin',
          entityType: 'order',
          entityId: order.id,
          oldValues: { total_amount_cents: previousTotal },
          newValues: { total_amount_cents: newTotalAmountCents, reason },
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
  async assignAssistant(
    adminUserId: string,
    orderId: string,
    technicianProfileId: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const order = await this.findOrThrow(orderId);
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
    const alreadyAssistant = await this.teamMembers.findOne({
      where: { orderId, technicianId: technician.id, memberType: ASSISTANT_MEMBER_TYPE },
    });
    if (alreadyAssistant) {
      throw new ApiException(ErrorCode.VAL_001, 'الفني ده معيّن كمساعد على الطلب ده بالفعل', HttpStatus.CONFLICT);
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
      newValues: { technician_id: technician.id },
      meta,
    });

    return order;
  }

  // ── إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41) ────────────────────────
  // كانت فجوة موثّقة صراحة: OrderTeamService.addMember()/removeMember() مقصورين على الفني
  // القائد بس (technician-leader-ownership-gated)، assignAssistant() فوق مقصور على شغل
  // "مساعد" بس. صلاحية مخصصة (orders.manage_crew، migration 0132) — عملية تشغيلية يومية
  // زي orders.assign_assistant، مش قرار super_admin بس.

  private async validateCrewCandidateOrThrow(order: Order, technicianProfileId: string): Promise<void> {
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
  }

  /** إضافة عضو طاقم (Ops حل نقص طاقم، مش شغل "مساعد" بالضرورة — راجع assignAssistant فوق للمساعد تحديدًا). */
  async addCrewMember(adminUserId: string, orderId: string, technicianId: string, roleLabel: string, meta?: AuditActorMeta): Promise<Order> {
    const order = await this.findOrThrow(orderId);
    await this.validateCrewCandidateOrThrow(order, technicianId);

    const existingCount = await this.teamMembers.count({ where: { orderId } });
    if (existingCount >= MAX_TEAM_MEMBERS_PER_ORDER) {
      throw new ApiException(ErrorCode.VAL_001, `أقصى عدد أعضاء فريق للطلب هو ${MAX_TEAM_MEMBERS_PER_ORDER}`, HttpStatus.BAD_REQUEST);
    }

    // Script 4 Part Q — سباق حقيقي ممكن: أدمنين اتنين بيضيفوا نفس الفني لنفس الطلب بالتوازي
    // بالظبط، الفحص فوق (validateCrewCandidateOrThrow) مش ذرّي. الـUNIQUE constraint في الداتابيز
    // (order_id, technician_id، migration 0060) هو خط الدفاع الأخير اللي بيمنع صف مكرر فعليًا —
    // هنا بس بنحوّل خطأ الداتابيز الخام لنفس رسالة 409 الواضحة اللي الفحص العادي بيرجّعها.
    try {
      await this.teamMembers.save(
        this.teamMembers.create({ orderId, technicianId, roleLabel, addedByTechnicianId: null, addedByAdminUserId: adminUserId }),
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
      newValues: { technician_id: technicianId, role_label: roleLabel },
      meta,
    });
    return order;
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

    // جاهزية الطاقم (Script 4 §22-29: "don't silently show ready" لو الطاقم نقص) — required_technicians
    // هو snapshot محرك الإنتاجية وقت الحجز (orders.service.ts)، مفيش تعقّب لدور محدد بعد، فده
    // مؤشر عددي بسيط بس (العدد الكلي بعد الإزالة مقابل المطلوب) مش تطابق أدوار دقيق.
    const remaining = await this.teamMembers.count({ where: { orderId } });
    const crewShortage = order.requiredTechnicians != null && remaining + 1 < order.requiredTechnicians;
    return { crewShortage };
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
    await this.validateCrewCandidateOrThrow(order, newTechnicianId);

    const oldMember = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderTeamMember);
      // إعادة قراءة جوّه الترانزاكشن (مش الاعتماد على existingMember المقروء فوق) — يحمي من
      // سباق حذف/استبدال متزامن على نفس العضو بين التحقق فوق والتنفيذ هنا.
      const existing = await repo.findOne({ where: { id: memberId, orderId } });
      if (!existing) {
        throw new ApiException(ErrorCode.VAL_001, 'عضو الفريق ده غير موجود (اتشال قبل كده)', HttpStatus.NOT_FOUND);
      }
      const roleLabel = roleLabelOverride ?? existing.roleLabel;
      await repo.remove(existing);
      // نفس حماية addCrewMember فوق — سباق ممكن: الفني الجديد بقى عضو بالفعل (إضافة متزامنة)
      // بين التحقق فوق (validateCrewCandidateOrThrow) وهنا.
      try {
        await repo.save(
          repo.create({ orderId, technicianId: newTechnicianId, roleLabel, addedByTechnicianId: null, addedByAdminUserId: adminUserId }),
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
      newValues: { technician_id: newTechnicianId, reason },
      meta,
    });
    return order;
  }

  // نفس نمط RatingsService.isUniqueViolation() بالحرف — خطأ Postgres الخام (23505) بيتحوّل
  // لرسالة 409 واضحة بدل ما يتسرّب كـ500 عام.
  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
  }
}
