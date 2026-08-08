import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Between, DataSource, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_REASSIGNED_EVENT, OrderReassignedEvent } from '../../common/events/order-reassigned.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { AuditActorMeta, AuditLogService } from '../audit/audit-log.service';
import { TechnicianVerificationStatus } from '../technicians/entities/technician-profile.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { AssignmentStatus, OrderAssignment } from '../matching/entities/order-assignment.entity';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canTransition } from './order-state-machine';

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
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly techniciansService: TechniciansService,
    private readonly events: EventEmitter2,
    private readonly auditLog: AuditLogService,
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

  async getDetail(orderId: string): Promise<{ order: Order; history: OrderStatusHistory[] }> {
    const order = await this.findOrThrow(orderId);
    const history = await this.statusHistory.find({ where: { orderId }, order: { createdAt: 'ASC' } });
    return { order, history };
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
    await this.dataSource.transaction(async (manager) => {
      order.orderStatus = OrderStatus.CANCELLED_BY_SYSTEM;
      order.cancelledAt = new Date();
      order.cancelledByUserId = adminUserId;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.CANCELLED_BY_SYSTEM,
          changedByUserId: adminUserId,
          changedByRole: 'admin',
          changeSource: OrderChangeSource.ADMIN,
          reason,
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        OrderStatus.CANCELLED_BY_SYSTEM,
        order.customerId,
        order.technicianId,
        reason,
      ),
    );

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.cancelled_by_admin',
      entityType: 'order',
      entityId: order.id,
      oldValues: { order_status: previousStatus },
      newValues: { order_status: OrderStatus.CANCELLED_BY_SYSTEM, reason },
      meta,
    });

    return order;
  }

  async reassign(
    adminUserId: string,
    orderId: string,
    newTechnicianProfileId: string,
    meta?: AuditActorMeta,
  ): Promise<Order> {
    const order = await this.findOrThrow(orderId);
    if (!REASSIGNABLE_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تعيّن فني يدوي والطلب في حالة ${order.orderStatus} — التعيين متاح قبل ما أي فني يقبل الطلب بس`,
        HttpStatus.CONFLICT,
      );
    }

    const technician = await this.techniciansService.findByProfileIdOrThrow(newTechnicianProfileId);
    if (technician.verificationStatus !== TechnicianVerificationStatus.APPROVED) {
      throw new ApiException(ErrorCode.TECH_001, 'الفني ده لسه مش معتمد', HttpStatus.BAD_REQUEST);
    }
    if (order.technicianId === technician.id) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب ده معيّن للفني ده بالفعل', HttpStatus.CONFLICT);
    }

    const previousStatus = order.orderStatus;
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      order.technicianId = technician.id;

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
    });

    this.events.emit(ORDER_REASSIGNED_EVENT, new OrderReassignedEvent(order.id, order.orderNumber, technician.id));

    await this.auditLog.record({
      actorUserId: adminUserId,
      actorRole: 'admin',
      action: 'order.reassigned_by_admin',
      entityType: 'order',
      entityId: order.id,
      oldValues: { order_status: previousStatus, technician_id: null },
      newValues: { order_status: order.orderStatus, technician_id: technician.id },
      meta,
    });

    return order;
  }
}
