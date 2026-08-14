import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, LessThan, Repository } from 'typeorm';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';

const SWEEP_INTERVAL_MS = 60_000;
const AUTO_CANCEL_MINUTES_FALLBACK = 20;
// مهلة إلغاء تلقائي لطلب واقف في PENDING_PAYMENT (docs/08 §19 بند 3) — العميل بدأ دفع إلكتروني
// (كارت/InstaPay، ADR-0013 "PAY BEFORE DISPATCH") بس مخلّصش (سابته/فشل قبل webhook التأكيد).
// قيمة افتراضية تطويرية آمنة أقصر من مهلة البحث عن فني عمدًا — مفيش داعي الطلب يفضل حاجز
// نافذة توزيع لفني وهو أصلاً مدفوعش لسه.
const PAYMENT_TIMEOUT_MINUTES_FALLBACK = 15;

/**
 * كانت فجوة موثّقة صراحة في settings/README.md: `orders.auto_cancel_after_minutes` كان مزروع
 * بس مش مستخدم خالص — الميزة (job إلغاء تلقائي لطلب فضل معلّق) مبنيتش أصلاً.
 *
 * **قرار تصميم متعمّد**: فحص دوري (`setInterval`) بيعيد الاستعلام من القاعدة كل دقيقة، مش BullMQ
 * delayed job لكل طلب زي `matching.service.ts`'s round timeouts. لو استخدمنا نفس آلية BullMQ،
 * الميزة دي كانت هتعتمد على **نفس** الـ Worker اللي عنده بَقّة موثّقة حقيقية (مبيرجعش يعالج وظايف
 * جديدة بعد انقطاع Redis طويل — تفاصيل في `../technicians/README.md`) — يعني "شبكة الأمان" هتقع
 * بنفس السبب اللي المفروض تحمي منه. الفحص الدوري هنا مستقل تماماً: بيعيد التقييم من Postgres
 * مباشرة كل مرة، مفيش حالة متخزّنة في Redis ممكن "تعلق".
 *
 * **تحديث (docs/08 §19 بند 3+5)**: الفحص بقى يغطي مسارين إضافيين — (أ) طلبات PENDING_PAYMENT
 * قديمة (العميل بدأ دفع إلكتروني مسبق بس مخلّصش) بتتلغى بلا استرداد (الدفع أصلاً مكملش)، (ب)
 * طلبات SEARCHING_TECHNICIAN مدفوعة بالفعل (كارت/InstaPay) بياخدوا استرداد فوري تلقائي عبر
 * `PaymentsService.refundSystemCancelledOrder()` بعد الإلغاء مباشرة — مفيش عكس أرباح فني في
 * الحالة دي لأن مفيش فني اتعيّن أصلاً (technicianId=null بالتعريف وقت SEARCHING_TECHNICIAN).
 *
 * **فجوة موثّقة صراحة، خارج نطاق هذا الإصلاح عمدًا**: لو الطلب استخدم promo code وقت الإنشاء،
 * `PromoCode.usedCount` بيتزوّد في `promo-codes.service.ts`'s `validateAndApply()` بس مفيش أي
 * decrement/release لاستخدام الكود ده في أي مسار إلغاء بالكامل (مش بس هنا — ولا في
 * `OrdersService.cancel()` ولا إلغاء الفني). ده قصور نظامي أوسع سابق على هذا التعديل، محتاج قرار
 * عمل منفصل (هل الاستخدام يترجع لو الطلب اتلغى بلا خدمة فعلية؟) مش جزء من بند 3+5 تحديدًا.
 */
@Injectable()
export class OrderAutoCancelService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderAutoCancelService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly events: EventEmitter2,
    private readonly paymentsService: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error('فشل sweep الإلغاء التلقائي', err instanceof Error ? err.stack : err));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const minutes = await this.settingsService.getNumber('orders.auto_cancel_after_minutes', AUTO_CANCEL_MINUTES_FALLBACK);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    const staleOrders = await this.orders.find({
      select: ['id'],
      where: { orderStatus: OrderStatus.SEARCHING_TECHNICIAN, placedAt: LessThan(cutoff) },
    });

    let cancelledCount = 0;
    for (const { id } of staleOrders) {
      const cancelled = await this.cancelIfStillSearching(id, minutes);
      if (cancelled) cancelledCount++;
    }
    if (cancelledCount > 0) {
      this.logger.log(`الإلغاء التلقائي: ${cancelledCount} طلب اتلغى بعد ${minutes} دقيقة من غير فني`);
    }

    const pendingPaymentCancelledCount = await this.sweepPendingPayment();

    return cancelledCount + pendingPaymentCancelledCount;
  }

  // بيدوّر بقفل ذري (pessimistic_write) نفس نمط matching.service.ts's accept() — لو فني قبل
  // الطلب أو matching نفسها لغته في نفس اللحظة، أي محاولتين بيتصادفوا بيتحلّوا بأمان (الأولى
  // تكسب القفل، التانية بتشوف order_status اتغيّر وترجع false من غير أي كسر).
  private async cancelIfStillSearching(orderId: string, minutes: number): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();

      if (!order || order.orderStatus !== OrderStatus.SEARCHING_TECHNICIAN) return null;

      order.orderStatus = OrderStatus.CANCELLED_BY_SYSTEM;
      order.cancelledAt = new Date();
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: OrderStatus.SEARCHING_TECHNICIAN,
          newStatus: OrderStatus.CANCELLED_BY_SYSTEM,
          changeSource: OrderChangeSource.SYSTEM,
          reason: `إلغاء تلقائي — مفيش فني قبل الطلب خلال ${minutes} دقيقة`,
        }),
      );
      return order;
    });

    if (!result) return false;

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        result.id,
        result.orderNumber,
        OrderStatus.SEARCHING_TECHNICIAN,
        OrderStatus.CANCELLED_BY_SYSTEM,
        result.customerId,
        result.technicianId,
        `إلغاء تلقائي — مفيش فني قبل الطلب خلال ${minutes} دقيقة`,
      ),
    );

    // استرداد فوري (docs/08 §19 بند 5) — الطلب ده كان مدفوع بالفعل (كارت/InstaPay مسبق الدفع،
    // ADR-0013) وقت ما اتلغى لعدم توفر فني. برّه الـtransaction فوق عمدًا: refundSystemCancelledOrder()
    // بتفتح transactions مستقلة بتاعتها ونداء بوابة خارجي حقيقي، ومفيش داعي هي وcancelIfStillSearching
    // يشتركوا في نفس القفل — الطلب أصلاً بقى CANCELLED_BY_SYSTEM نهائي دلوقتي، مفيش سباق ممكن يحصل
    // على orderStatus تاني. فشل الاسترداد هنا (استثناء غير متوقع) بيتلقط ويتسجّل بس مايوقفش بقية
    // sweep() — نفس فلسفة onModuleInit's catch، الطلب فضل ملغي صح حتى لو الاسترداد فشل واحتاج
    // متابعة يدوية.
    if (result.paymentStatus === OrderPaymentStatus.PAID) {
      try {
        await this.paymentsService.refundCancelledPrepaidOrder(
          result.id,
          `استرداد تلقائي — الطلب اتلغى نظاميًا لعدم توفر فني خلال ${minutes} دقيقة`,
          'system_auto_cancel',
        );
      } catch (err) {
        this.logger.error(
          `فشل الاسترداد التلقائي لطلب ${result.orderNumber} بعد الإلغاء النظامي — محتاج مراجعة يدوية`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return true;
  }

  // طلبات PENDING_PAYMENT قديمة (docs/08 §19 بند 3) — العميل بدأ دفع إلكتروني بس مخلّصش. مفيش
  // فني اتوزّع عليها أصلاً (pay-before-dispatch، ADR-0013)، فمفيش استرداد مطلوب هنا — الدفع نفسه
  // لسه مكملش (paymentStatus لسه UNPAID)، مفيش فلوس اتاخدت أصلاً عشان ترجع.
  private async sweepPendingPayment(): Promise<number> {
    const minutes = await this.settingsService.getNumber('orders.payment_timeout_minutes', PAYMENT_TIMEOUT_MINUTES_FALLBACK);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    const staleOrders = await this.orders.find({
      select: ['id'],
      where: { orderStatus: OrderStatus.PENDING_PAYMENT, placedAt: LessThan(cutoff) },
    });

    let cancelledCount = 0;
    for (const { id } of staleOrders) {
      const cancelled = await this.cancelIfStillPendingPayment(id, minutes);
      if (cancelled) cancelledCount++;
    }
    if (cancelledCount > 0) {
      this.logger.log(`الإلغاء التلقائي: ${cancelledCount} طلب اتلغى بعد ${minutes} دقيقة من غير إتمام الدفع`);
    }
    return cancelledCount;
  }

  private async cancelIfStillPendingPayment(orderId: string, minutes: number): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId })
        .getOne();

      if (!order || order.orderStatus !== OrderStatus.PENDING_PAYMENT) return null;

      order.orderStatus = OrderStatus.CANCELLED_BY_SYSTEM;
      order.cancelledAt = new Date();
      await manager.save(order);
      await manager.save(
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          previousStatus: OrderStatus.PENDING_PAYMENT,
          newStatus: OrderStatus.CANCELLED_BY_SYSTEM,
          changeSource: OrderChangeSource.SYSTEM,
          reason: `إلغاء تلقائي — الدفع ماتمش خلال ${minutes} دقيقة`,
        }),
      );
      return order;
    });

    if (!result) return false;

    this.events.emit(
      ORDER_STATUS_CHANGED_EVENT,
      new OrderStatusChangedEvent(
        result.id,
        result.orderNumber,
        OrderStatus.PENDING_PAYMENT,
        OrderStatus.CANCELLED_BY_SYSTEM,
        result.customerId,
        result.technicianId,
        `إلغاء تلقائي — الدفع ماتمش خلال ${minutes} دقيقة`,
      ),
    );
    return true;
  }
}
