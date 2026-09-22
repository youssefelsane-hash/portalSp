import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { PromoCodesService } from '../promotions/promo-codes.service';
import { SettingsService } from '../settings/settings.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';

const SWEEP_INTERVAL_MS = 60_000;
// مهلة إلغاء تلقائي لطلب واقف في PENDING_PAYMENT (docs/08 §19 بند 3) — العميل بدأ دفع إلكتروني
// (كارت/InstaPay، ADR-0013 "PAY BEFORE DISPATCH") بس مخلّصش (سابته/فشل قبل webhook التأكيد).
// قيمة افتراضية تطويرية آمنة أقصر من مهلة البحث عن فني عمدًا — مفيش داعي الطلب يفضل حاجز
// نافذة توزيع لفني وهو أصلاً مدفوعش لسه.
const PAYMENT_TIMEOUT_MINUTES_FALLBACK = 15;
const SWEEP_BATCH_SIZE = 25;

/**
 * **طلب بلّغ عنه العميل تحويل InstaPay مايتلغيش تلقائيًا** (قرار مالك 2026-09-21).
 *
 * > «الـadmin بيكون محدد مدة معينة للطلبات اللي مش مدفوعة فيها بتتلغي أوتوماتيك، وده مضبوط…
 * > ولكن لما يكون العميل بلغ التحويل، الطلب ما يتلغيش، لأن ده ممكن يكون الراجل فعليًا حوّل
 * > الفلوس. الطلب ما بيتلغيش أصلًا غير لو الـadmin لغاه من عنده.»
 *
 * الواقع التشغيلي اللي بيخلّي ده لازم: تأكيد تحويل InstaPay بشري وبيمرّ على موظف مالي — ممكن
 * ياخد ١٢ ساعة، يوم، أو يومين في الإجازات. مهلة الإلغاء التلقائي بالدقايق (افتراضي ١٥)، يعني
 * عميل حوّل فلوس حقيقية كان طلبه بيتلغي من تحته قبل ما حد يبص على التحويل أصلاً.
 *
 * **ليه الحالات التلاتة دي بالذات**: هي «التحويل لسه مفتوح» — نفس `ACTIVE_ORDER_PAYMENT_STATUSES`
 * في `payments.service.ts`. الأدمن لو **رفض** التحويل، `rejectInstaPayPayment()` بتحط الدفعة
 * `failed`، فالطلب بيرجع قابل للإلغاء التلقائي زي أي طلب مدفوعش — وده الصح: العميل ادّعى تحويل
 * واتثبت إنه مش موجود. لو كان الحارس على `customer_confirmed_transfer_at` لوحده من غير الحالة،
 * كان هيقفل الطلب للأبد حتى بعد الرفض.
 */
const OPEN_REPORTED_INSTAPAY_TRANSFER_EXISTS = `
  EXISTS (
    SELECT 1
      FROM payments p
     WHERE p.order_id = o.id
       AND p.payment_method = 'instapay'
       AND p.customer_confirmed_transfer_at IS NOT NULL
       AND p.payment_status IN ('pending', 'processing', 'manual_review')
  )`;

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
 * **تحديث (قرار عمل صريح من المالك، 2026-08-19) — مسار SEARCHING_TECHNICIAN اتشال بالكامل**:
 * كان فيه مسار تاني هنا بيلغي طلبات SEARCHING_TECHNICIAN قديمة (مفيش فني قبلها خلال
 * `orders.auto_cancel_after_minutes`) ويسترد فلوسها تلقائيًا لو مدفوعة مقدمًا. المالك أكّد صراحة
 * إنه مش عايز السلوك ده خالص — طلب مفيش فني متاح ليه لازم يفضل SEARCHING_TECHNICIAN للأبد
 * (والأدمن يتصرف يدويًا)، مش يتلغى تلقائيًا بصمت. المسار ده اتشال بالكامل (مش معطّل بس) — الملف
 * ده دلوقتي مسؤول بس عن `sweepPendingPayment()` (طلبات دفع إلكتروني مسبق ماتمّش، مالهاش علاقة
 * بتوفر فني خالص).
 *
 * **تحديث (§24 — تدقيق الاكتمال الداخلي، 2026-08-15)**: كانت فجوة موثّقة صراحة — `promo_codes.
 * used_count`/`spent_cents` بيتزودوا وقت استخدام الكود بس مفيش أي decrement/release في أي مسار
 * إلغاء. اتقفلت: `PromoCodesService.releaseUsage()` بينادى دلوقتي جوّه نفس transaction الإلغاء في
 * `cancelIfStillPendingPayment` وكمان في `OrdersService.cancel()` و`AdminOrdersService.cancel()`.
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
    private readonly promoCodesService: PromoCodesService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): نسخة واحدة بس هي اللي بتشغّل الدورة دي، حتى لو
      // التطبيق شغّال على أكتر من instance. `runExclusiveSweep` بتلقّط وتسجّل أي فشل.
      void runExclusiveSweep(this.dataSource, 'order-auto-cancel', () => this.sweep(), this.logger);
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // قرار عمل صريح من المالك (2026-08-19) — طلب لسه SEARCHING_TECHNICIAN (مفيش فني قبله لسه)
  // **مايتلغيش تلقائيًا خالص** بعد كده، مهما طالت المدة. الطلب يفضل "جاري البحث عن فني" والأدمن
  // هو اللي يتصرف يدويًا (تعيين قسري، أو إلغاء إداري لو قرر كده). ده عكس السلوك القديم اللي كان
  // بيلغي الطلب تلقائيًا بعد `orders.auto_cancel_after_minutes` (20 دقيقة افتراضيًا) — المالك
  // أكّد إن ده مش المطلوب: عميل طلب كاش (أو أي طريقة دفع) لازم طلبه يتقبل ويفضل قايم، مش يتلغى
  // بصمت لمجرد مفيش فني متاح دلوقتي. مسار PENDING_PAYMENT (دفع إلكتروني اتبدأ ومخلّصش) مختلف
  // تمامًا وفاضل شغال زي ما هو — ده مش عن توفر فني، ده عن دفع فعليًا ماتمش.
  /**
   * `options.orderNumberPrefix` — **نطاق اختياري للاختبارات بس**، نفس نمط
   * `RecurringOrdersService.sweep({ templateIds })` الموجود أصلاً في نفس الموديول.
   *
   * السبب: الـsweep دي بتلغي **أي** طلب `pending_payment` قديم في القاعدة كلها — وده الصح في
   * الإنتاج. لكن في الاختبارات المتوازية بقت بتلغي طلبات specs تانية، فـspec بيتوقّع
   * `manual_review` كان بيلاقي `cancelled` بسبب spec تاني خالص شغّال جنبه. فشل بيتقري كأنه
   * بَقّة في الكود وهو تلوّث بين الاختبارات.
   *
   * الإنتاج بينادي `sweep()` بلا معاملات فالسلوك مايتغيّرش بأي شكل.
   */
  async sweep(options?: { orderNumberPrefix?: string }): Promise<number> {
    return this.sweepPendingPayment(options?.orderNumberPrefix);
  }

  // طلبات PENDING_PAYMENT قديمة (docs/08 §19 بند 3) — العميل بدأ دفع إلكتروني بس مخلّصش. مفيش
  // فني اتوزّع عليها أصلاً (pay-before-dispatch، ADR-0013)، فمفيش استرداد مطلوب هنا — الدفع نفسه
  // لسه مكملش (paymentStatus لسه UNPAID)، مفيش فلوس اتاخدت أصلاً عشان ترجع.
  private async sweepPendingPayment(orderNumberPrefix?: string): Promise<number> {
    const minutes = await this.settingsService.getNumber('orders.payment_timeout_minutes', PAYMENT_TIMEOUT_MINUTES_FALLBACK);
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    // نوبة card متكررة لها نافذة تحصيل مستقلة حتى T-24 ساعة (`RecurringOrdersService`).
    // لا يجوز لمهلة الطلب العادي (دقائق) أن تلغيها قبل أن تبدأ محاولاتها المجدولة.
    const staleOrders = await this.orders
      .createQueryBuilder('o')
      .select(['o.id'])
      .where('o.order_status = :status', { status: OrderStatus.PENDING_PAYMENT })
      .andWhere('o.placed_at < :cutoff', { cutoff })
      .andWhere('(o.recurring_template_id IS NULL OR o.payment_method IS DISTINCT FROM :card)', { card: 'card' })
      // العميل بلّغ تحويل InstaPay لسه مفتوح ⇒ برّه الـsweep خالص (شوف الثابت فوق).
      .andWhere(`NOT ${OPEN_REPORTED_INSTAPAY_TRANSFER_EXISTS}`)
      .andWhere(orderNumberPrefix ? 'o.order_number LIKE :prefix' : 'TRUE', orderNumberPrefix ? { prefix: `${orderNumberPrefix}%` } : {})
      .orderBy('o.placed_at', 'ASC')
      .take(SWEEP_BATCH_SIZE)
      .getMany();

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

      // **إعادة الفحص جوّه القفل مش تزويد — ده سباق حقيقي بفلوس.** الاستعلام فوق بيختار
      // الطلبات في لحظة، والإلغاء بيحصل بعدها بلحظات. لو العميل دوس «حوّلت» في الفرق ده،
      // الفحص الأول بيكون عدّى والطلب بيتلغي وهو مدفوع فعلاً. الفحص هنا تحت
      // `pessimistic_write` على نفس الصف، فأي تبليغ سبق الإلغاء بيتشاف.
      const reported: Array<{ exists: boolean }> = await manager.query(
        `SELECT ${OPEN_REPORTED_INSTAPAY_TRANSFER_EXISTS} AS exists FROM orders o WHERE o.id = $1`,
        [orderId],
      );
      if (reported[0]?.exists) return null;

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
      await this.promoCodesService.releaseUsage(manager, order.id);
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
