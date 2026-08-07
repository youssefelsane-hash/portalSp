import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { AddressesService } from '../customers/addresses.service';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { GeoService } from '../geo/geo.service';
import { TechniciansService } from '../technicians/technicians.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order, OrderPaymentStatus, OrderSourceChannel, OrderStatus, OrderType } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { CUSTOMER_CANCELLABLE_STATUSES, canTransition } from './order-state-machine';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly addressesService: AddressesService,
    private readonly catalogService: CatalogService,
    private readonly geoService: GeoService,
    private readonly techniciansService: TechniciansService,
    private readonly events: EventEmitter2,
  ) {}

  findAllForCustomerUser(userId: string): Promise<Order[]> {
    return this.customerProfiles.findByUserIdOrThrow(userId).then((profile) =>
      this.orders.find({ where: { customerId: profile.id }, order: { createdAt: 'DESC' } }),
    );
  }

  async findOneOwnedOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, customerId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const address = await this.addressesService.findOwnedOrThrow(userId, dto.address_id);
    const service = await this.catalogService.findServiceOrThrow(dto.service_id);

    if (!address.cityId) {
      throw new ApiException(ErrorCode.ORDR_001, 'العنوان مش مربوط بمدينة', HttpStatus.BAD_REQUEST);
    }
    const zone = await this.geoService.findZoneForCity(address.cityId);
    if (!zone) {
      throw new ApiException(ErrorCode.ORDR_001, 'الخدمة غير متاحة في منطقتك لسه', HttpStatus.BAD_REQUEST);
    }

    const estimate = await this.catalogService.estimate(service.id, zone.id);

    const order = await this.dataSource.transaction(async (manager) => {
      const [{ next_human_readable_number: orderNumber }] = await manager.query<
        { next_human_readable_number: string }[]
      >("SELECT next_human_readable_number('ORD')");

      const now = new Date();
      const order = manager.create(Order, {
        orderNumber,
        customerId: customerProfile.id,
        serviceId: service.id,
        addressId: address.id,
        serviceZoneId: zone.id,
        orderType: dto.order_type ?? OrderType.STANDARD,
        orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
        problemDescription: dto.problem_description ?? null,
        customerNotes: dto.customer_notes ?? null,
        scheduledAt: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
        estimatedPriceCents: estimate.estimated_total_cents,
        inspectionFeeCents: estimate.inspection_fee_cents,
        totalAmountCents: estimate.estimated_total_cents + estimate.inspection_fee_cents,
        paymentStatus: OrderPaymentStatus.UNPAID,
        placedAt: now,
        sourceChannel: OrderSourceChannel.CUSTOMER_APP,
      });
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: null,
          newStatus: OrderStatus.SEARCHING_TECHNICIAN,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
        }),
      );

      return order;
    });

    // بره الـ transaction عمداً — matching لازم يشتغل على بيانات مؤكّدة (committed) بس
    this.events.emit(ORDER_CREATED_EVENT, new OrderCreatedEvent(order.id));

    return order;
  }

  async cancel(userId: string, orderId: string, reason: string | undefined): Promise<Order> {
    const order = await this.findOneOwnedOrThrow(userId, orderId);

    if (!CUSTOMER_CANCELLABLE_STATUSES.has(order.orderStatus)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تلغي الطلب وهو في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }
    if (!canTransition(order.orderStatus, OrderStatus.CANCELLED_BY_CUSTOMER)) {
      throw new ApiException(ErrorCode.ORDR_003, 'انتقال حالة غير مسموح', HttpStatus.CONFLICT);
    }

    const previousStatus = order.orderStatus;
    await this.dataSource.transaction(async (manager) => {
      order.orderStatus = OrderStatus.CANCELLED_BY_CUSTOMER;
      order.cancelledAt = new Date();
      order.cancelledByUserId = userId;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.CANCELLED_BY_CUSTOMER,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason: reason ?? null,
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        OrderStatus.CANCELLED_BY_CUSTOMER,
        order.customerId,
        order.technicianId,
      ),
    );

    return order;
  }

  // ── دورة عمل الفني: قبل → في الطريق → وصل → بدأ → خلص ───────────────────

  private async findOwnedByTechnicianOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  /** مصدر واحد لكل انتقالات الفني — بتحترم الـ state machine وبتسجل التاريخ زي أي انتقال تاني. */
  private async transitionAsTechnician(
    userId: string,
    orderId: string,
    to: OrderStatus,
    applyTimestamp: (order: Order, now: Date) => void,
  ): Promise<Order> {
    const order = await this.findOwnedByTechnicianOrThrow(userId, orderId);

    if (!canTransition(order.orderStatus, to)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تنتقل من ${order.orderStatus} لـ ${to}`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = order.orderStatus;
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      order.orderStatus = to;
      applyTimestamp(order, now);
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: to,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, to, order.customerId, order.technicianId),
    );

    return order;
  }

  depart(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.TECHNICIAN_ON_WAY, (order, now) => {
      order.technicianDepartedAt = now;
    });
  }

  arrive(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.TECHNICIAN_ARRIVED, (order, now) => {
      order.technicianArrivedAt = now;
    });
  }

  start(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.IN_PROGRESS, (order, now) => {
      order.workStartedAt = now;
    });
  }

  complete(userId: string, orderId: string): Promise<Order> {
    return this.transitionAsTechnician(userId, orderId, OrderStatus.WORK_COMPLETED, (order, now) => {
      order.workCompletedAt = now;
    });
  }
}
