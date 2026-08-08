import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, LessThan, Repository } from 'typeorm';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { SettingsService } from '../settings/settings.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderChangeSource, OrderStatusHistory } from './entities/order-status-history.entity';

const SWEEP_INTERVAL_MS = 60_000;
const AUTO_CANCEL_MINUTES_FALLBACK = 20;

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
    return cancelledCount;
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
    return true;
  }
}
