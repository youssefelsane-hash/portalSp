import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { Order, OrderPaymentStatus } from '../orders/entities/order.entity';

export type OrderPriceIncreaseSource = 'level_premium' | 'additional_work' | 'inspection_quote';

export interface OrderPriceIncrease {
  amountCents: number;
  source: OrderPriceIncreaseSource;
  includeInCommissionableBase: boolean;
}

export interface OrderPriceIncreaseResult {
  previousTotalCents: number;
  newTotalCents: number;
  commissionableIncreaseCents: number;
  requiresSupplementalCollection: boolean;
}

/**
 * The single write path for approved post-creation price increases.
 *
 * Existing successful payments and installment applications are immutable financial snapshots.
 * Increasing a paid order therefore creates an amount still due; it must never rewrite the old
 * payment or silently stretch an accepted installment plan. PaymentsService.amountOwedNow() derives
 * that supplemental obligation from the new total minus the preserved payment snapshots.
 */
@Injectable()
export class OrderFinancialFinalizationService {
  async increasePrice(
    manager: EntityManager,
    order: Order,
    adjustment: OrderPriceIncrease,
  ): Promise<OrderPriceIncreaseResult> {
    if (!Number.isSafeInteger(adjustment.amountCents) || adjustment.amountCents < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'قيمة تعديل السعر غير صالحة', HttpStatus.BAD_REQUEST);
    }

    const previousTotalCents = order.totalAmountCents;
    const commissionableIncreaseCents =
      adjustment.includeInCommissionableBase && order.commissionableBaseCents !== null
        ? adjustment.amountCents
        : 0;

    order.totalAmountCents += adjustment.amountCents;
    if (order.commissionableBaseCents !== null) {
      order.commissionableBaseCents += commissionableIncreaseCents;
    }
    await manager.save(order);

    return {
      previousTotalCents,
      newTotalCents: order.totalAmountCents,
      commissionableIncreaseCents,
      requiresSupplementalCollection:
        adjustment.amountCents > 0 && order.paymentStatus === OrderPaymentStatus.PAID,
    };
  }
}
