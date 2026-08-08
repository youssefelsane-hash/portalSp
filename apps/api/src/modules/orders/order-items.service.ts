import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { QuoteItemDto } from './dto/propose-quote-items.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canTransition } from './order-state-machine';

// دورة عرض السعر أثناء التنفيذ (docs/02-data-dictionary.md §6.2/§6.4) — كانت فجوة موثّقة
// صراحة في orders/README.md و catalog/README.md ("order_items لسه من غير، جزء من S7").
// النطاق: بس بنود إضافية (قطع غيار/أجرة إضافية/إضافات) بيقترحها الفني أثناء الشغل ومحتاجة
// موافقة العميل قبل ما تتحسب على السعر النهائي — بند الخدمة الأساسي نفسه بره النطاق ده تماماً
// (بيتحدد من الكتالوج وقت إنشاء الطلب، مش من هنا).
@Injectable()
export class OrderItemsService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly events: EventEmitter2,
  ) {}

  private async findOwnedByTechnicianOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.techniciansService.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, technicianId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  private async findOwnedByCustomerOrThrow(userId: string, orderId: string): Promise<Order> {
    const profile = await this.customerProfiles.findByUserIdOrThrow(userId);
    const order = await this.orders.findOne({ where: { id: orderId, customerId: profile.id } });
    if (!order) {
      throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
    }
    return order;
  }

  listForOrder(orderId: string): Promise<OrderItem[]> {
    return this.orderItems.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  async listForTechnician(userId: string, orderId: string): Promise<OrderItem[]> {
    await this.findOwnedByTechnicianOrThrow(userId, orderId);
    return this.listForOrder(orderId);
  }

  async listForCustomer(userId: string, orderId: string): Promise<OrderItem[]> {
    await this.findOwnedByCustomerOrThrow(userId, orderId);
    return this.listForOrder(orderId);
  }

  // الفني بيقترح بنود جديدة أثناء الشغل — لازم الطلب يكون in_progress (نفس شرط state machine:
  // in_progress → awaiting_quote_approval بس). لو فيه بنود معلّقة من قبل (نظرياً مستحيل هنا لأن
  // الحالة مش هتبقى in_progress لو فيه بنود معلّقة أصلاً)، بيترفض بوضوح برضه عن طريق canTransition.
  async propose(userId: string, orderId: string, items: QuoteItemDto[]): Promise<{ order: Order; items: OrderItem[] }> {
    const order = await this.findOwnedByTechnicianOrThrow(userId, orderId);

    if (!canTransition(order.orderStatus, OrderStatus.AWAITING_QUOTE_APPROVAL)) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        `مينفعش تقترح عرض سعر والطلب في حالة ${order.orderStatus}`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = order.orderStatus;
    const created = await this.dataSource.transaction(async (manager) => {
      const rows = items.map((item) =>
        manager.create(OrderItem, {
          orderId: order.id,
          itemType: item.item_type,
          nameAr: item.name_ar,
          description: item.description ?? null,
          quantity: String(item.quantity),
          unitName: item.unit_name ?? null,
          unitPriceCents: item.unit_price_cents,
          totalPriceCents: Math.round(item.quantity * item.unit_price_cents),
          isCustomerApproved: false,
          addedByUserId: userId,
        }),
      );
      await manager.save(rows);

      order.orderStatus = OrderStatus.AWAITING_QUOTE_APPROVAL;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.AWAITING_QUOTE_APPROVAL,
          changedByUserId: userId,
          changedByRole: 'technician',
          changeSource: OrderChangeSource.TECHNICIAN,
          metadata: { proposed_items: rows.map((r) => ({ name_ar: r.nameAr, total_price_cents: r.totalPriceCents })) },
        }),
      );

      return rows;
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, order.orderStatus, order.customerId, order.technicianId),
    );

    return { order, items: created };
  }

  // العميل وافق على كل البنود المعلّقة دفعة واحدة — بيتضافوا لـ total_amount_cents (نفس العمود
  // اللي مسارات الدفع الموجودة بالفعل بتستخدمه، فمفيش أي تعديل مطلوب في payments.service.ts).
  async approve(userId: string, orderId: string): Promise<{ order: Order; items: OrderItem[] }> {
    const order = await this.findOwnedByCustomerOrThrow(userId, orderId);
    if (order.orderStatus !== OrderStatus.AWAITING_QUOTE_APPROVAL) {
      throw new ApiException(ErrorCode.ORDR_003, 'مفيش عرض سعر مستني الموافقة لهذا الطلب', HttpStatus.CONFLICT);
    }

    const pending = await this.orderItems.find({ where: { orderId, isCustomerApproved: false } });
    if (pending.length === 0) {
      throw new ApiException(ErrorCode.ORDR_003, 'مفيش بنود معلّقة للموافقة عليها', HttpStatus.CONFLICT);
    }

    const addedCents = pending.reduce((sum, item) => sum + item.totalPriceCents, 0);
    const previousStatus = order.orderStatus;

    await this.dataSource.transaction(async (manager) => {
      const now = new Date();
      await manager.update(OrderItem, { id: In(pending.map((i) => i.id)) }, { isCustomerApproved: true, approvedAt: now });

      order.totalAmountCents += addedCents;
      order.orderStatus = OrderStatus.IN_PROGRESS;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.IN_PROGRESS,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason: `العميل وافق على عرض السعر — ${pending.length} بند بقيمة ${addedCents} قرش`,
          metadata: { approved_items: pending.map((i) => ({ name_ar: i.nameAr, total_price_cents: i.totalPriceCents })) },
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        OrderStatus.IN_PROGRESS,
        order.customerId,
        order.technicianId,
        `العميل وافق على عرض السعر — ${pending.length} بند بقيمة ${addedCents} قرش`,
      ),
    );

    return { order, items: await this.listForOrder(orderId) };
  }

  // العميل رفض البنود المقترحة — بيتشالوا نهائي (مفيش عمود "مرفوض" في order_items أصلاً،
  // القرار المتعمّد هنا: بدل ما نضيف migration لعمود جديد لسيناريو مش موصوف بالتفصيل في القاموس،
  // بنسجّل لقطة كاملة بالبنود المرفوضة في order_status_history.metadata (سجل تدقيق كافي) ونشيلهم
  // من order_items — الشغل بيكمل بنفس النطاق الأساسي بس من غير أي تأثير على total_amount_cents.
  // إلغاء الطلب بالكامل (لو العميل مش عايز يكمل خالص) مسار منفصل: state machine بتسمح
  // awaiting_quote_approval → cancelled_by_customer، واتضافت للفعل في CUSTOMER_CANCELLABLE_STATUSES
  // عشان تستخدم OrdersService.cancel() الموجودة (نفس منطق رسوم الإلغاء) بدل ما نكرره هنا.
  async decline(userId: string, orderId: string): Promise<{ order: Order }> {
    const order = await this.findOwnedByCustomerOrThrow(userId, orderId);
    if (order.orderStatus !== OrderStatus.AWAITING_QUOTE_APPROVAL) {
      throw new ApiException(ErrorCode.ORDR_003, 'مفيش عرض سعر مستني الموافقة لهذا الطلب', HttpStatus.CONFLICT);
    }

    const pending = await this.orderItems.find({ where: { orderId, isCustomerApproved: false } });
    const previousStatus = order.orderStatus;

    await this.dataSource.transaction(async (manager) => {
      if (pending.length > 0) {
        await manager.delete(OrderItem, { id: In(pending.map((i) => i.id)) });
      }

      order.orderStatus = OrderStatus.IN_PROGRESS;
      await manager.save(order);

      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus,
          newStatus: OrderStatus.IN_PROGRESS,
          changedByUserId: userId,
          changedByRole: 'customer',
          changeSource: OrderChangeSource.CUSTOMER,
          reason: `العميل رفض عرض السعر — ${pending.length} بند`,
          metadata: { declined_items: pending.map((i) => ({ name_ar: i.nameAr, total_price_cents: i.totalPriceCents })) },
        }),
      );
    });

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        order.id,
        order.orderNumber,
        previousStatus,
        OrderStatus.IN_PROGRESS,
        order.customerId,
        order.technicianId,
        `العميل رفض عرض السعر — ${pending.length} بند`,
      ),
    );

    return { order };
  }
}
