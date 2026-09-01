import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { PaymentsService } from '../payments/payments.service';
import { TechniciansService } from '../technicians/technicians.service';
import { QuoteItemDto } from './dto/propose-quote-items.dto';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { AdditionalWorkProposalStatus, OrderItem } from './entities/order-item.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';
import { canTransition } from './order-state-machine';
import { CommissionBaseService } from '../pricing/commission-base.service';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';

// دورة عرض السعر أثناء التنفيذ (docs/02-data-dictionary.md §6.2/§6.4) — كانت فجوة موثّقة
// صراحة في orders/README.md و catalog/README.md ("order_items لسه من غير، جزء من S7").
// النطاق: بس بنود إضافية (قطع غيار/أجرة إضافية/إضافات) بيقترحها الفني أثناء الشغل ومحتاجة
// موافقة العميل قبل ما تتحسب على السعر النهائي — بند الخدمة الأساسي نفسه بره النطاق ده تماماً
// (بيتحدد من الكتالوج وقت إنشاء الطلب، مش من هنا).
@Injectable()
export class OrderItemsService {
  private readonly logger = new Logger(OrderItemsService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly orderItems: Repository<OrderItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly paymentsService: PaymentsService,
    private readonly events: EventEmitter2,
    // ADR-0037 — آخر بند عمدًا عشان السبيكات اللي بتبني الخدمة بـpositional args تحتاج append واحد بس.
    private readonly commissionBaseService: CommissionBaseService,
    private readonly orderFinancials: OrderFinancialFinalizationService,
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
    const technicianProfile = await this.techniciansService.findByUserIdOrThrow(userId);
    // كل بنود نداء propose() الواحد بيشاركوا batch_id واحد (docs/08 §21) — عشان موافقة العميل
    // عليهم تعامَل كـ"طلب واحد" (obligation دفع واحد)، مش N بند منفصل.
    const batchId = randomUUID();
    const result = await this.dataSource.transaction(async (manager) => {
      // القفل وإعادة قراءة الحالة هنا، مش قبل transaction: طلبا propose متزامنان لا يمكنهما
      // كلاهما رؤية IN_PROGRESS وإنشاء دفعتين مفتوحتين.
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.technician_id = :technicianId', { orderId, technicianId: technicianProfile.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود أو مش بتاعك', HttpStatus.NOT_FOUND);
      }
      if (!canTransition(order.orderStatus, OrderStatus.AWAITING_QUOTE_APPROVAL)) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          `مينفعش تقترح عرض سعر والطلب في حالة ${order.orderStatus}`,
          HttpStatus.CONFLICT,
        );
      }
      const previousStatus = order.orderStatus;
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
          proposalStatus: AdditionalWorkProposalStatus.PENDING,
          declinedAt: null,
          declinedByUserId: null,
          addedByUserId: userId,
          batchId,
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

      return { order, rows, previousStatus };
    });

    const { order, rows: created, previousStatus } = result;

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(order.id, order.orderNumber, previousStatus, order.orderStatus, order.customerId, order.technicianId),
    );

    return { order, items: created };
  }

  // العميل وافق على كل البنود المعلّقة دفعة واحدة — بيتضافوا لـ total_amount_cents (نفس العمود
  // اللي مسارات الدفع الموجودة بالفعل بتستخدمه). لو الطلب مدفوع مسبقًا إلكترونيًا (ADR-0013/0015)
  // **والعميل اختار electronic** (الافتراضي)، موافقة العميل بتطلق محاولة تحصيل فورية للدلتا
  // (docs/08 §21) — الشغل يكمل بغض النظر عن النتيجة. لو اختار **cash** (docs/08 §22 بند 8)، صفر
  // محاولة تحصيل إلكتروني — المبلغ يتجمّع في total_amount_cents ويتحصّل كاش وقت الاكتمال بالضبط
  // زي أي طلب مختلط (نفس المسار المُختبر بالفعل في cash-settlement-direction.spec.ts "طلب مختلط").
  async approve(
    userId: string,
    orderId: string,
    paymentChoice: 'cash' | 'electronic' = 'electronic',
  ): Promise<{ order: Order; items: OrderItem[] }> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    // قفل pessimistic على الطلب + إعادة تحميل البنود المعلّقة **جوّه** نفس الـtransaction (docs/08
    // §21 بند 12) — كانت فجوة تزامن حقيقية: موافقتين متزامنتين على نفس الطلب كانتا بيقدروا الاتنين
    // يعدّوا فحص "فيه بنود معلّقة" قبل ما أي واحدة تلتزم، فيتضاف addedCents مرتين لـtotal_amount_cents
    // (تحصيل مزدوج). القفل + إعادة فحص orderStatus بعد الحصول عليه بيمنع ده تمامًا — الموافقة التانية
    // (بعد ما تستنى القفل) هتلاقي orderStatus بقى in_progress بالفعل وترفض بوضوح.
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.customer_id = :customerId', { orderId, customerId: customerProfile.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.orderStatus !== OrderStatus.AWAITING_QUOTE_APPROVAL) {
        throw new ApiException(ErrorCode.ORDR_003, 'مفيش عرض سعر مستني الموافقة لهذا الطلب', HttpStatus.CONFLICT);
      }

      const pending = await manager.find(OrderItem, {
        where: { orderId, proposalStatus: AdditionalWorkProposalStatus.PENDING },
      });
      if (pending.length === 0) {
        throw new ApiException(ErrorCode.ORDR_003, 'مفيش بنود معلّقة للموافقة عليها', HttpStatus.CONFLICT);
      }

      // التصميم الحالي يدعم batches متتابعة، وليس batches مفتوحة متوازية. التحقق يمنع أي
      // بيانات تالفة أو مسار مستقبلي من تجميع مبلغ عدة batches ثم نسبته إلى pending[0].
      const pendingBatchIds = [...new Set(pending.map((item) => item.batchId))];
      if (pendingBatchIds.length !== 1 || !pendingBatchIds[0]) {
        throw new ApiException(
          ErrorCode.ORDR_003,
          'بيانات عرض السعر غير متسقة — لازم يكون للطلب المعلّق batch واحد محدد',
          HttpStatus.CONFLICT,
        );
      }
      const batchId = pendingBatchIds[0];

      const addedCents = pending.reduce((sum, item) => sum + item.totalPriceCents, 0);
      const previousStatus = order.orderStatus;
      const now = new Date();

      await manager.update(
        OrderItem,
        { id: In(pending.map((i) => i.id)) },
        { isCustomerApproved: true, approvedAt: now, proposalStatus: AdditionalWorkProposalStatus.APPROVED },
      );

      // ADR-0037 / docs/08 §60.1 — بند إضافي معتمد أثناء الشغل **شغل حقيقي بينفّذه الفني**
      // (طلب مالك صريح: "لو طلب زيادة أثناء الشغل، ده برضه بيعتبر ضمن الشغل")، فبيدخل وعاء
      // العمولة زي سعر الخدمة الأصلي بالظبط — مش زي الضمان أو فوايد التقسيط.
      //
      // بنقرا السياسة هنا مش وقت التسوية عشان نفس سبب الـsnapshot وقت الإنشاء: الوعاء لازم
      // يعكس السياسة السارية وقت ما الشغل اتعمل فعلاً. `null` = طلب قبل migration 0192،
      // بيفضل null (السلوك القديم: الوعاء = الإجمالي وقت التسوية).
      const policy = await this.commissionBaseService.getPolicy();
      await this.orderFinancials.increasePrice(manager, order, {
        amountCents: addedCents,
        source: 'additional_work',
        includeInCommissionableBase: policy.includeAdditionalItems,
      });
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

      return { order, pending, batchId, addedCents, previousStatus };
    });

    const { order, pending, batchId, addedCents, previousStatus } = result;

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

    // تحصيل فوري للدلتا (docs/08 §21 بند 5) — برّه الـtransaction عمداً (نداء بوابة خارجي حقيقي،
    // نفس نمط الـ3 مراحل المستخدم في PaymentsService.refundOrder()). فشل هنا **ميرجّعش خطأ للعميل**
    // ولا بيرجع الموافقة اللي اتسجّلت بالفعل — المبلغ يفضل obligation مسجّل يتحصّل لاحقًا (completion
    // check أو retry يدوي)، الموافقة نفسها عملية منجزة بالفعل.
    if (order.paymentStatus === OrderPaymentStatus.PAID && paymentChoice === 'electronic') {
      try {
        await this.paymentsService.attemptAdditionalWorkCharge(order.id, batchId, addedCents);
      } catch (err) {
        this.logger.error(
          `فشل محاولة تحصيل شغل إضافي للطلب ${order.id} (دفعة ${batchId}) — المبلغ يفضل obligation مسجّل`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return { order, items: await this.listForOrder(orderId) };
  }

  // العميل يرفض البنود المقترحة مع الاحتفاظ بها كدليل lifecycle مستقل؛ لا DELETE لعرض مالي رآه
  // العميل. الشغل يكمل بنفس النطاق الأساسي ومن دون أثر على total_amount_cents.
  // إلغاء الطلب بالكامل (لو العميل مش عايز يكمل خالص) مسار منفصل: state machine بتسمح
  // awaiting_quote_approval → cancelled_by_customer، واتضافت للفعل في CUSTOMER_CANCELLABLE_STATUSES
  // عشان تستخدم OrdersService.cancel() الموجودة (نفس منطق رسوم الإلغاء) بدل ما نكرره هنا.
  async decline(userId: string, orderId: string): Promise<{ order: Order }> {
    const customerProfile = await this.customerProfiles.findByUserIdOrThrow(userId);

    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId AND o.customer_id = :customerId', { orderId, customerId: customerProfile.id })
        .getOne();
      if (!order) {
        throw new ApiException(ErrorCode.VAL_001, 'الطلب غير موجود', HttpStatus.NOT_FOUND);
      }
      if (order.orderStatus !== OrderStatus.AWAITING_QUOTE_APPROVAL) {
        throw new ApiException(ErrorCode.ORDR_003, 'مفيش عرض سعر مستني الموافقة لهذا الطلب', HttpStatus.CONFLICT);
      }

      const pending = await manager.find(OrderItem, {
        where: { orderId, proposalStatus: AdditionalWorkProposalStatus.PENDING },
      });
      if (pending.length === 0) {
        throw new ApiException(ErrorCode.ORDR_003, 'مفيش بنود معلّقة للرفض لهذا الطلب', HttpStatus.CONFLICT);
      }
      const previousStatus = order.orderStatus;
      const now = new Date();

      await manager.update(
        OrderItem,
        { id: In(pending.map((i) => i.id)) },
        {
          proposalStatus: AdditionalWorkProposalStatus.DECLINED,
          declinedAt: now,
          declinedByUserId: userId,
        },
      );

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
      return { order, pending, previousStatus };
    });

    const { order, pending, previousStatus } = result;

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
