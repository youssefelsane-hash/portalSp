import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { ORDER_QUOTE_EXPIRED_EVENT, OrderQuoteExpiredEvent } from '../../common/events/order-quote-expired.event';
import { Order } from './entities/order.entity';
import { OrderQuote, OrderQuoteSource, OrderQuoteStatus } from './entities/order-quote.entity';
import { InspectionQuoteService } from './inspection-quote.service';

const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 25;

/**
 * **ADR-0067 §2 — كاسح انتهاء صلاحية عروض السعر.**
 *
 * `order_quotes.valid_until` كانت بتتكتب صح من أول يوم، لكن الانتهاء كان **كسول بالكامل**: العرض
 * مايتعلّمش `expired` غير لما العميل يحاول يوافق متأخر أو الأدمن يعيد الإصدار. يعني عميل ماحاولش
 * أصلاً كان طلبه بيفضل معلّق على عرض ميّت للأبد، وفلتر `expired_quote` في طابور الأدمن كان بيرجع
 * فاضي لأن مفيش صف بيتعلّم `expired` من غير محاولة بشرية.
 *
 * نفس نمط `OrderAutoCancelService` بالحرف: `setInterval` بيعيد الاستعلام من Postgres مباشرة، مش
 * BullMQ delayed job — عشان ما نبنيش شبكة الأمان دي فوق الـWorker اللي عنده بَقّة إعادة الاتصال
 * الموثّقة (`technicians/README.md`).
 *
 * الكتابة نفسها **مش هنا**: `InspectionQuoteService.expireQuoteInTransaction()` هي الكاتب الوحيد
 * لحالة `expired` في المنظومة كلها.
 */
@Injectable()
export class QuoteExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuoteExpiryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly inspectionQuoteService: InspectionQuoteService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) =>
        this.logger.error('فشل sweep انتهاء صلاحية العروض', err instanceof Error ? err.stack : err),
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    // `pending_admin_review` **مستثنى عمدًا**: العرض ده لسه ماوصلش العميل أصلاً، فمهلة رده عليه
    // مالهاش معنى — مهلته بتبدأ من لحظة اعتماد الأدمن (`decideAboveRangeQuote`).
    const due = await this.dataSource
      .createQueryBuilder(OrderQuote, 'q')
      .select('q.id', 'id')
      .where('q.status = :status', { status: OrderQuoteStatus.PENDING_CUSTOMER })
      .andWhere('q.valid_until <= NOW()')
      .orderBy('q.valid_until', 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .getRawMany<{ id: string }>();

    let expiredCount = 0;
    for (const { id } of due) {
      if (await this.expireOne(id)) expiredCount++;
    }
    if (expiredCount > 0) {
      this.logger.log(`انتهت صلاحية ${expiredCount} عرض سعر`);
    }
    return expiredCount;
  }

  private async expireOne(quoteId: string): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const quote = await manager
        .createQueryBuilder(OrderQuote, 'q')
        .setLock('pessimistic_write')
        .where('q.id = :quoteId', { quoteId })
        .getOne();
      // العميل ممكن يكون وافق في نفس اللحظة بين الاستعلام والقفل — القفل هنا هو اللي بيحسم.
      if (!quote || quote.status !== OrderQuoteStatus.PENDING_CUSTOMER) return null;
      if (quote.validUntil.getTime() > Date.now()) return null;

      const order = await manager
        .createQueryBuilder(Order, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :orderId', { orderId: quote.orderId })
        .getOne();
      if (!order) return null;

      await this.inspectionQuoteService.expireQuoteInTransaction(manager, order, quote);
      return { order, quote };
    });

    if (!result) return false;

    this.events.emit(
      ORDER_QUOTE_EXPIRED_EVENT,
      new OrderQuoteExpiredEvent(
        result.order.id,
        result.order.orderNumber,
        result.order.customerId,
        result.quote.id,
        result.quote.amountCents,
        result.quote.source === OrderQuoteSource.ADMIN_REMOTE ? null : result.quote.submittedByUserId,
      ),
    );
    return true;
  }
}
