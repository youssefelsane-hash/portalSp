import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ORDER_RESCHEDULED_EVENT, OrderRescheduledEvent } from '../../common/events/order-rescheduled.event';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { GeoService } from '../geo/geo.service';
import { TechnicianScheduleSlot, TechnicianScheduleSlotStatus } from '../technicians/entities/technician-schedule-slot.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechniciansService } from '../technicians/technicians.service';
import { SettingsService } from '../settings/settings.service';
import { insertDurableInAppNotification } from './durable-in-app-notification';
import { Order, OrderStatus } from './entities/order.entity';
import { CreateTechnicianRescheduleRequestDto } from './dto/create-technician-reschedule-request.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderQueriesService } from './order-queries.service';
import { assertNoScheduleOverlap, resolveRescheduledInterval, slotEnd, slotStart } from './order-schedule-interval';

export type OrderRescheduleRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface OrderRescheduleRequestResponse {
  id: string;
  order_id: string;
  technician_id: string;
  proposed_slot_id: string;
  proposed_at: Date;
  proposed_end_at: Date;
  reason: string;
  status: OrderRescheduleRequestStatus;
  resolved_at: Date | null;
  created_at: Date;
}

// إعادة الجدولة (docs/08 §22 بند 9-12) متاحة بس قبل ما الفني يبدأ يتحرّك فعليًا — بعد
// technician_on_way الموعد بقى واقعي (الفني في الطريق)، تغييره في اللحظة دي مش "إعادة جدولة" لطلب
// مستقبلي، ده تصادم مع رحلة شغالة فعلاً.
const RESCHEDULABLE_STATUSES = new Set<OrderStatus>([OrderStatus.TECHNICIAN_ASSIGNED, OrderStatus.ACCEPTED]);

/**
 * **فلو إعادة جدولة الطلب — الشريحة ٢-ب من تقسيم `OrdersService`** (تدقيق A-1).
 *
 * الفلو ده وحده كان **~٥٩٠ سطر** جوّه خدمة بـ٢٥ اعتمادية، رغم إنه محتاج **١١** منهم بس.
 * جمعه هنا بيخلي عقده مقروءًا في مكان واحد: مين يقدر يعيد الجدولة، وامتى، وإيه اللي بيتقفل
 * ذرّيًا وقت التغيير.
 *
 * ## المسارات الأربعة
 *
 * | المسار | مين | الفرق الجوهري |
 * |--------|-----|----------------|
 * | `reschedule` | العميل | بيغيّر مباشرة (بحدود `assertReschedulable`) |
 * | `requestRescheduleByTechnician` | الفني | **طلب** محتاج موافقة العميل، بسقف عدد محاولات |
 * | `resolveTechnicianRescheduleRequest` | العميل | موافقة/رفض على طلب الفني |
 * | `rescheduleByAdmin` | الإدارة | نفس آلية الحجز الذرّي، بسبب إلزامي |
 *
 * كلهم بيعدّوا على `rescheduleCore()` — مصدر واحد للحجز الذرّي (قفل تشاؤمي + إعادة فحص الحالة
 * تحت القفل + تحرير السلوت القديم وحجز الجديد في نفس الـtransaction).
 *
 * `OrdersService` بتفوّض لكل الدوال العامة هنا بنفس التوقيعات بالحرف — صفر تغيير على أي منادي.
 */
@Injectable()
export class OrderRescheduleService {
  private readonly logger = new Logger(OrderRescheduleService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly queries: OrderQueriesService,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly scheduleService: TechnicianScheduleService,
    private readonly settingsService: SettingsService,
    private readonly geoService: GeoService,
    private readonly addressesService: AddressesService,
    private readonly auditLog: AuditLogService,
    private readonly events: EventEmitter2,
  ) {}

  async reschedule(userId: string, orderId: string, dto: RescheduleOrderDto): Promise<Order> {
    const order = await this.queries.findOneOwnedOrThrow(userId, orderId);
    return this.rescheduleCore(order, {
      newSlotId: dto.new_slot_id,
      newScheduledAt: dto.new_scheduled_at,
      newScheduledEndAt: dto.new_scheduled_end_at,
    }, {
      userId,
      role: 'customer',
      changeSource: OrderChangeSource.CUSTOMER,
    });
  }

  async listRescheduleOptionsForCustomer(
    userId: string,
    orderId: string,
  ): Promise<{ date: string; available: boolean }[]> {
    await this.queries.findOneOwnedOrThrow(userId, orderId);
    return this.listRescheduleOptions(orderId);
  }

  async requestRescheduleByTechnician(
    userId: string,
    orderId: string,
    dto: CreateTechnicianRescheduleRequestDto,
  ): Promise<OrderRescheduleRequestResponse> {
    const technician = await this.techniciansService.findByUserIdOrThrow(userId);
    const configuredMax = await this.settingsService.getNumber('orders.technician_reschedule_max_requests', 2);
    const maxRequests = Math.max(1, Math.min(20, Math.floor(configuredMax)));

    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.technician_id = :technicianId', { orderId, technicianId: technician.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
      }
      this.assertReschedulable(order);

      const currentSlot = await manager.findOne(TechnicianScheduleSlot, {
        where: { orderId, status: TechnicianScheduleSlotStatus.BOOKED },
      });
      if (!currentSlot) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش مرتبط بموعد محدد أصلاً', HttpStatus.CONFLICT);
      }
      if (currentSlot.id === dto.new_slot_id) {
        throw new ApiException(ErrorCode.VAL_001, 'اختار موعدًا مختلفًا عن الموعد الحالي', HttpStatus.BAD_REQUEST);
      }

      const proposedSlot = await manager
        .createQueryBuilder(TechnicianScheduleSlot, 'slot')
        .setLock('pessimistic_read')
        .where('slot.id = :slotId', { slotId: dto.new_slot_id })
        .andWhere('slot.status = :status', { status: TechnicianScheduleSlotStatus.AVAILABLE })
        .andWhere('slot.deleted_at IS NULL')
        .getOne();
      if (!proposedSlot) {
        throw new ApiException(ErrorCode.VAL_001, 'الموعد المقترح لم يعد متاحًا', HttpStatus.CONFLICT);
      }
      if (proposedSlot.technicianId !== technician.id) {
        throw new ApiException(ErrorCode.VAL_001, 'تقدر تقترح موعدًا من جدولك أنت فقط', HttpStatus.BAD_REQUEST);
      }
      const proposedAt = slotStart(proposedSlot);
      if (proposedAt.getTime() <= Date.now()) {
        throw new ApiException(ErrorCode.VAL_001, 'لا يمكن اقتراح موعد انتهى أو بدأ بالفعل', HttpStatus.BAD_REQUEST);
      }

      const [{ count }] = await manager.query<{ count: string }[]>(
        'SELECT COUNT(*)::text AS count FROM order_reschedule_requests WHERE order_id = $1 AND technician_id = $2',
        [orderId, technician.id],
      );
      if (Number(count) >= maxRequests) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          `وصلت للحد الأقصى لطلبات التأجيل (${maxRequests}) — تواصل مع الدعم لو محتاج تغيير إضافي`,
          HttpStatus.CONFLICT,
        );
      }

      const pending = await manager.query<{ id: string }[]>(
        "SELECT id FROM order_reschedule_requests WHERE order_id = $1 AND status = 'pending' LIMIT 1",
        [orderId],
      );
      if (pending.length > 0) {
        throw new ApiException(ErrorCode.ORDR_003, 'فيه طلب تأجيل منتظر قرار العميل بالفعل', HttpStatus.CONFLICT);
      }

      const [request] = await manager.query<OrderRescheduleRequestResponse[]>(
        `INSERT INTO order_reschedule_requests (order_id, technician_id, proposed_slot_id, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING id, order_id, technician_id, proposed_slot_id,
                   ($5::date + $6::time) AS proposed_at,
                   ($5::date + $7::time) AS proposed_end_at,
                   reason, status, resolved_at, created_at`,
        [orderId, technician.id, proposedSlot.id, dto.reason.trim(), proposedSlot.slotDate, proposedSlot.startTime, proposedSlot.endTime],
      );

      const customer = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
      await insertDurableInAppNotification(manager, {
        userId: customer.userId,
        notificationType: 'order_reschedule_requested',
        titleAr: 'الفني يقترح تغيير الموعد',
        bodyAr: `الفني طلب تأجيل طلب رقم ${order.orderNumber}. افتح الطلب للموافقة أو الرفض.`,
        orderId,
        deepLink: `/orders/${orderId}`,
      });
      return request;
    });
  }

  async listRescheduleRequestsForCustomer(userId: string, orderId: string): Promise<OrderRescheduleRequestResponse[]> {
    await this.queries.findOneOwnedOrThrow(userId, orderId);
    return this.listRescheduleRequests(orderId);
  }

  async listRescheduleRequestsForTechnician(userId: string, orderId: string): Promise<OrderRescheduleRequestResponse[]> {
    await this.queries.findOwnedByTechnicianOrThrow(userId, orderId);
    return this.listRescheduleRequests(orderId);
  }

  private listRescheduleRequests(orderId: string): Promise<OrderRescheduleRequestResponse[]> {
    return this.dataSource.query<OrderRescheduleRequestResponse[]>(
      `SELECT request.id, request.order_id, request.technician_id, request.proposed_slot_id,
              (slot.slot_date + slot.start_time) AS proposed_at,
              (slot.slot_date + slot.end_time) AS proposed_end_at,
              request.reason, request.status, request.resolved_at, request.created_at
       FROM order_reschedule_requests request
       JOIN technician_schedule_slots slot ON slot.id = request.proposed_slot_id
       WHERE request.order_id = $1
       ORDER BY request.created_at DESC`,
      [orderId],
    );
  }

  async resolveTechnicianRescheduleRequest(
    userId: string,
    orderId: string,
    requestId: string,
    decision: 'approved' | 'rejected',
  ): Promise<{ request: OrderRescheduleRequestResponse; order: Order }> {
    const customer = await this.customerProfiles.findByUserIdOrThrow(userId);

    const result = await this.dataSource.transaction<{
      request: OrderRescheduleRequestResponse;
      order: Order;
      rescheduled: { previousScheduledAt: Date | null; newScheduledAt: Date } | null;
    }>(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.customer_id = :customerId', { orderId, customerId: customer.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }

      const [request] = await manager.query<
        Array<{ id: string; proposed_slot_id: string; technician_id: string; status: OrderRescheduleRequestStatus }>
      >(
        'SELECT id, proposed_slot_id, technician_id, status FROM order_reschedule_requests WHERE id = $1 AND order_id = $2 FOR UPDATE',
        [requestId, orderId],
      );
      if (!request) {
        throw new ApiException(ErrorCode.VAL_001, 'طلب التأجيل غير موجود', HttpStatus.NOT_FOUND);
      }
      if (request.status !== 'pending') {
        throw new ApiException(ErrorCode.ORDR_003, 'تم اتخاذ قرار في طلب التأجيل ده بالفعل', HttpStatus.CONFLICT);
      }

      const rescheduled =
        decision === 'approved'
          ? await this.rescheduleLockedOrder(
              manager,
              order,
              request.proposed_slot_id,
              {
                userId,
                role: 'customer',
                changeSource: OrderChangeSource.CUSTOMER,
                reasonSuffix: ' — موافقة على طلب تأجيل الفني',
              },
              request.id,
            )
          : null;

      await manager.query(
        `UPDATE order_reschedule_requests
         SET status = $3, resolved_by_user_id = $4, resolved_at = now(), updated_at = now()
         WHERE id = $1 AND order_id = $2`,
        [requestId, orderId, decision, userId],
      );
      const [updatedRequest] = await manager.query<OrderRescheduleRequestResponse[]>(
        `SELECT request.id, request.order_id, request.technician_id, request.proposed_slot_id,
                (slot.slot_date + slot.start_time) AS proposed_at,
                (slot.slot_date + slot.end_time) AS proposed_end_at,
                request.reason, request.status, request.resolved_at, request.created_at
         FROM order_reschedule_requests request
         JOIN technician_schedule_slots slot ON slot.id = request.proposed_slot_id
         WHERE request.id = $1`,
        [requestId],
      );

      const technician = await this.techniciansService.findByProfileIdOrThrow(request.technician_id);
      await insertDurableInAppNotification(manager, {
        userId: technician.userId,
        notificationType: decision === 'approved' ? 'order_reschedule_approved' : 'order_reschedule_rejected',
        titleAr: decision === 'approved' ? 'العميل وافق على تأجيل الموعد' : 'العميل رفض تأجيل الموعد',
        bodyAr:
          decision === 'approved'
            ? `تم اعتماد الموعد المقترح لطلب رقم ${order.orderNumber}.`
            : `العميل فضّل الاحتفاظ بالموعد الحالي لطلب رقم ${order.orderNumber}.`,
        orderId,
        deepLink: `/technician/orders/${orderId}`,
      });

      return { request: updatedRequest, order, rescheduled };
    });

    if (result.rescheduled && result.order.technicianId) {
      this.events.emit(
        ORDER_RESCHEDULED_EVENT,
        new OrderRescheduledEvent(
          result.order.id,
          result.order.orderNumber,
          result.order.technicianId,
          result.order.customerId,
          result.rescheduled.previousScheduledAt,
          result.rescheduled.newScheduledAt,
          'technician_request',
          true,
        ),
      );
    }
    return { request: result.request, order: result.order };
  }

  /**
   * إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — بعكس reschedule() فوق (مقصور على العميل
   * صاحب الطلب)، ده لأي طلب بغض النظر عن هوية العميل. استخدام تشغيلي حقيقي: العميل يتصل بخدمة
   * العملاء يطلب تأجيل الموعد، الموظف بينفذها نيابة عنه — بديل عن الدخول على الداتابيز يدويًا.
   * نفس آلية الحجز الذرّي بالحرف (rescheduleCore المشتركة)، الفرق بس هوية المنفّذ + سبب إلزامي
   * للتدقيق (مش مطلوب من العميل نفسه لما بيعيد جدولة طلبه هو).
   */
  async rescheduleByAdmin(
    adminUserId: string,
    orderId: string,
    target: { newSlotId?: string; newScheduledAt?: string; newScheduledEndAt?: string },
    reason: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    const previousScheduledAt = order.scheduledAt;
    const updated = await this.rescheduleCore(order, target, {
      userId: adminUserId,
      role: 'admin',
      changeSource: OrderChangeSource.ADMIN,
      reasonSuffix: ` — سبب: ${reason}`,
    });
    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.rescheduled_by_admin',
      entityType: 'order',
      entityId: orderId,
      oldValues: {
        scheduled_at: previousScheduledAt?.toISOString() ?? null,
        scheduled_end_at: order.scheduledEndAt?.toISOString() ?? null,
      },
      newValues: {
        scheduled_at: updated.scheduledAt?.toISOString() ?? null,
        scheduled_end_at: updated.scheduledEndAt?.toISOString() ?? null,
        reason,
      },
      meta,
    });
    return updated;
  }
  /** ADR-0034 — نفس منطق حل المنطقة اللي `create()` بتستخدمه بالحرف (point-in-polygon حقيقي). */
  private async resolveZoneForOrderOrThrow(order: Order): Promise<{ id: string }> {
    const address = await this.addressesService.findByIdOrThrow(order.addressId);
    if (!address.cityId) {
      throw new ApiException(ErrorCode.ORDR_001, 'العنوان مش مربوط بمدينة', HttpStatus.BAD_REQUEST);
    }
    const [longitude, latitude] = address.location.coordinates;
    const zone = await this.geoService.findZoneForPoint(address.cityId, latitude, longitude);
    if (!zone) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقة الطلب ده', HttpStatus.BAD_REQUEST);
    }
    return zone;
  }

  /**
   * ADR-0034 بند 3 — الأيام الجاية وحالة إتاحة الفني المعيّن في كل يوم. بيحل محل قايمة السلوتات
   * القديمة في لوحة إعادة الجدولة بالأدمن، اللي كانت بترجع فاضية دايمًا بعد ADR-0017 (النموذج
   * بقى opt-out: غياب صف = متاح، فمفيش صفوف `available` أصلاً تتعرض).
   */
  async listRescheduleOptions(orderId: string, days = 14): Promise<{ date: string; available: boolean }[]> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    if (!order.technicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مفيهوش فني معيّن لسه', HttpStatus.CONFLICT);
    }
    const zone = await this.resolveZoneForOrderOrThrow(order);
    const technicianId = order.technicianId;
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const options: { date: string; available: boolean }[] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const day = new Date(startOfToday.getTime() + offset * 24 * 60 * 60 * 1000);
       
      const available = await this.techniciansService.hasEligibleTechnicianForDate(
        order.serviceId,
        zone.id,
        order.addressId,
        day,
        technicianId,
        orderId,
      );
      options.push({ date: day.toISOString().slice(0, 10), available });
    }
    return options;
  }

  /**
   * ADR-0034 — مسارين لتحديد الموعد الجديد: `newScheduledAt` (يوم، الافتراضي دلوقتي) أو
   * `newSlotId` (سلوت صريح من جدول الفني، المسار القديم اللي ADR-0017 بند 1 أبقى عليه للعميل
   * اللي بيختار سلوت بعينه). بالظبط واحد منهم. كل اللي بعد تحديد `newScheduledAt` مشترك بالحرف
   * بين المسارين (القفل التشاؤمي، سجل التاريخ، الحدث) — مفيش دالة موازية.
   */
  private async rescheduleCore(
    order: Order,
    target: { newSlotId?: string; newScheduledAt?: string; newScheduledEndAt?: string },
    actor: { userId: string; role: string; changeSource: OrderChangeSource; reasonSuffix?: string },
  ): Promise<Order> {
    const orderId = order.id;
    if ((target.newSlotId == null) === (target.newScheduledAt == null)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'لازم تبعت الموعد الجديد (new_scheduled_at) أو سلوت محدد (new_slot_id) — واحد بس مش الاتنين',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (target.newScheduledEndAt != null && target.newScheduledAt == null) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'الموعد النهائي الجديد يتطلب إرسال موعد البداية الجديد معه',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.assertReschedulable(order);

    let newSlot: TechnicianScheduleSlot | null = null;
    let newScheduledAt: Date;
    let zone: { id: string } | null = null;

    if (target.newSlotId != null) {
      const currentSlot = await this.scheduleService.findSlotForOrder(orderId);
      if (!currentSlot) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش مرتبط بموعد محدد أصلاً', HttpStatus.CONFLICT);
      }
      newSlot = await this.scheduleService.findAvailableSlotOrThrow(target.newSlotId);
      if (newSlot.technicianId !== order.technicianId) {
        throw new ApiException(
          ErrorCode.VAL_001,
          'السلوت الجديد لازم يكون لنفس الفني المعيّن على الطلب — تغيير الفني نفسه مسار مختلف',
          HttpStatus.BAD_REQUEST,
        );
      }
      newScheduledAt = slotStart(newSlot);
    } else {
      newScheduledAt = new Date(target.newScheduledAt as string);
      if (Number.isNaN(newScheduledAt.getTime())) {
        throw new ApiException(ErrorCode.VAL_001, 'الموعد الجديد مش تاريخ صالح', HttpStatus.BAD_REQUEST);
      }
      zone = await this.resolveZoneForOrderOrThrow(order);
    }

    const previousScheduledAt = order.scheduledAt;
    const customer = actor.role === 'admin' ? await this.customerProfiles.findByProfileIdOrThrow(order.customerId) : null;
    const updatedOrder = await this.dataSource.transaction(async (manager) => {
      // كل مسارات إعادة الجدولة تمسك قفل الطلب أولاً ثم السلوت، لمنع deadlock مع موافقة
      // العميل على اقتراح الفني التي تستخدم نفس الترتيب.
      const fresh = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();
      if (!fresh) throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      this.assertReschedulable(fresh);
      const interval = resolveRescheduledInterval(fresh, newScheduledAt, target.newScheduledEndAt);

      if (newSlot) {
        if (interval.scheduledEndAt && interval.scheduledEndAt > slotEnd(newSlot)) {
          throw new ApiException(
            ErrorCode.VAL_001,
            'السلوت الجديد أقصر من مدة الطلب — اختار سلوت يغطي وقت الشغل كاملًا',
            HttpStatus.CONFLICT,
          );
        }
        const booked = await this.scheduleService.rescheduleSlot(orderId, newSlot.id, manager);
        if (!booked) {
          throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز من حد تاني لسه، اختار سلوت تاني', HttpStatus.CONFLICT);
        }
      } else {
        const free = await this.techniciansService.hasEligibleTechnicianForDate(
          fresh.serviceId,
          zone!.id,
          fresh.addressId,
          newScheduledAt,
          fresh.technicianId!,
          orderId,
        );
        if (!free) {
          throw new ApiException(
            ErrorCode.VAL_001,
            'الفني مش متاح في اليوم ده (إجازة محددة منه، أو عنده شغل تاني بيتعارض) — اختار يوم تاني',
            HttpStatus.CONFLICT,
          );
        }
        if (interval.durationMinutes != null) {
          await assertNoScheduleOverlap(
            manager,
            {
              technicianId: fresh.technicianId!,
              startsAt: newScheduledAt,
              endsAt: interval.scheduledEndAt ?? new Date(newScheduledAt.getTime() + interval.durationMinutes * 60_000),
              excludeOrderId: orderId,
            },
            (orderNumber) => `الفني ده عنده طلب آخر (${orderNumber}) متعارض مع الفترة الجديدة`,
          );
        }
        await manager
          .createQueryBuilder()
          .update(TechnicianScheduleSlot)
          .set({ status: TechnicianScheduleSlotStatus.AVAILABLE, orderId: null })
          .where('order_id = :orderId', { orderId })
          .execute();
      }

      fresh.scheduledAt = newScheduledAt;
      fresh.scheduledEndAt = interval.scheduledEndAt;
      fresh.durationMinutes = interval.durationMinutes;
      fresh.durationHours = interval.durationMinutes != null && interval.durationMinutes % 60 === 0
        ? interval.durationMinutes / 60
        : null;
      await manager.save(fresh);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId,
          previousStatus: fresh.orderStatus,
          newStatus: fresh.orderStatus,
          changedByUserId: actor.userId,
          changedByRole: actor.role,
          changeSource: actor.changeSource,
          reason: `إعادة جدولة — من ${previousScheduledAt?.toISOString() ?? 'بلا موعد'} لـ ${newScheduledAt.toISOString()}${actor.reasonSuffix ?? ''}`,
        }),
      );
      await manager.query(
        `UPDATE order_reschedule_requests
         SET status = 'cancelled', resolved_at = now(), updated_at = now()
         WHERE order_id = $1 AND status = 'pending'`,
        [orderId],
      );

      if (customer) {
        await insertDurableInAppNotification(manager, {
          userId: customer.userId,
          notificationType: 'order_rescheduled',
          titleAr: 'تم تغيير موعد طلبك',
          bodyAr: `الإدارة غيّرت موعد طلب رقم ${fresh.orderNumber}. افتح الطلب لمراجعة الموعد الجديد.`,
          orderId,
          deepLink: `/orders/${orderId}`,
        });
      }
      return fresh;
    });

    this.events.emit(
      ORDER_RESCHEDULED_EVENT,
      new OrderRescheduledEvent(
        updatedOrder.id,
        updatedOrder.orderNumber,
        updatedOrder.technicianId!,
        updatedOrder.customerId,
        previousScheduledAt,
        newScheduledAt,
        actor.role === 'admin' ? 'admin' : 'customer',
        false,
        customer !== null,
      ),
    );
    return updatedOrder;
  }

  private assertReschedulable(order: Order): void {
    if (!RESCHEDULABLE_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تعيد جدولة الطلب والفني في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }
    if (!order.technicianId) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مفيهوش فني معيّن لسه', HttpStatus.CONFLICT);
    }
  }

  private async rescheduleLockedOrder(
    manager: EntityManager,
    order: Order,
    newSlotId: string,
    actor: { userId: string; role: string; changeSource: OrderChangeSource; reasonSuffix?: string },
    approvedRequestId?: string,
  ): Promise<{ previousScheduledAt: Date | null; newScheduledAt: Date }> {
    this.assertReschedulable(order);

    const currentSlot = await manager.findOne(TechnicianScheduleSlot, {
      where: { orderId: order.id, status: TechnicianScheduleSlotStatus.BOOKED },
    });
    if (!currentSlot) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده مش مرتبط بموعد محدد أصلاً', HttpStatus.CONFLICT);
    }
    if (currentSlot.id === newSlotId) {
      throw new ApiException(ErrorCode.VAL_001, 'اختار موعدًا مختلفًا عن الموعد الحالي', HttpStatus.BAD_REQUEST);
    }

    const newSlot = await manager
      .createQueryBuilder(TechnicianScheduleSlot, 'slot')
      .setLock('pessimistic_write')
      .where('slot.id = :newSlotId', { newSlotId })
      .andWhere('slot.status = :available', { available: TechnicianScheduleSlotStatus.AVAILABLE })
      .andWhere('slot.deleted_at IS NULL')
      .getOne();
    if (!newSlot) {
      throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز أو لم يعد متاحًا، اختار سلوت تاني', HttpStatus.CONFLICT);
    }
    if (newSlot.technicianId !== order.technicianId) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'السلوت الجديد لازم يكون لنفس الفني المعيّن على الطلب — تغيير الفني نفسه مسار مختلف',
        HttpStatus.BAD_REQUEST,
      );
    }

    const previousScheduledAt = order.scheduledAt;
    const newScheduledAt = slotStart(newSlot);
    const interval = resolveRescheduledInterval(order, newScheduledAt);
    if (interval.scheduledEndAt && interval.scheduledEndAt > slotEnd(newSlot)) {
      throw new ApiException(
        ErrorCode.VAL_001,
        'السلوت المقترح أقصر من مدة الطلب — اختار سلوت يغطي وقت الشغل كاملًا',
        HttpStatus.CONFLICT,
      );
    }
    const booked = await this.scheduleService.rescheduleSlot(order.id, newSlot.id, manager);
    if (!booked) {
      throw new ApiException(ErrorCode.VAL_001, 'السلوت ده اتحجز من حد تاني لسه، اختار سلوت تاني', HttpStatus.CONFLICT);
    }
    order.scheduledAt = newScheduledAt;
    order.scheduledEndAt = interval.scheduledEndAt;
    order.durationMinutes = interval.durationMinutes;
    order.durationHours = interval.durationMinutes != null && interval.durationMinutes % 60 === 0
      ? interval.durationMinutes / 60
      : null;
    await manager.save(order);
    await manager.save(
      manager.create(OrderStatusHistory, {
        orderId: order.id,
        previousStatus: order.orderStatus,
        newStatus: order.orderStatus,
        changedByUserId: actor.userId,
        changedByRole: actor.role,
        changeSource: actor.changeSource,
        reason: `إعادة جدولة — من ${previousScheduledAt?.toISOString() ?? 'بلا موعد'} لـ ${newScheduledAt.toISOString()}${actor.reasonSuffix ?? ''}`,
      }),
    );

    await manager.query(
      `UPDATE order_reschedule_requests
       SET status = 'cancelled', resolved_at = now(), updated_at = now()
       WHERE order_id = $1 AND status = 'pending' AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [order.id, approvedRequestId ?? null],
    );
    return { previousScheduledAt, newScheduledAt };
  }
}
