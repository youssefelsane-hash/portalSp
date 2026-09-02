import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { Order, OrderPaymentStatus } from '../orders/entities/order.entity';

export type OrderPriceIncreaseSource = 'level_premium' | 'additional_work' | 'inspection_quote';

export interface OrderPriceIncrease {
  amountCents: number;
  source: OrderPriceIncreaseSource;
  includeInCommissionableBase: boolean;
  /**
   * The approved work value can differ from the amount newly owed. Assessment-fee credit is the
   * canonical example: a 700 EGP work quote with a 100 EGP credited inspection adds 600 EGP to
   * the order total, while the full 700 EGP remains the commissionable work value.
   */
  commissionableAmountCents?: number;
}

export interface OrderPriceIncreaseResult {
  previousTotalCents: number;
  newTotalCents: number;
  commissionableIncreaseCents: number;
  requiresSupplementalCollection: boolean;
}

export interface OrderPriceReplacementResult {
  previousTotalCents: number;
  newTotalCents: number;
  previousCommissionableBaseCents: number | null;
  newCommissionableBaseCents: number | null;
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
    const requestedCommissionableAmount = adjustment.commissionableAmountCents ?? adjustment.amountCents;
    if (!Number.isSafeInteger(requestedCommissionableAmount) || requestedCommissionableAmount < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'قيمة وعاء العمولة غير صالحة', HttpStatus.BAD_REQUEST);
    }
    const commissionableIncreaseCents =
      adjustment.includeInCommissionableBase && order.commissionableBaseCents !== null
        ? requestedCommissionableAmount
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

  /** Replaces an unpaid price before any gateway or installment obligation has started. */
  async replaceUncommittedPrice(
    manager: EntityManager,
    order: Order,
    newTotalCents: number,
  ): Promise<OrderPriceReplacementResult> {
    if (!Number.isSafeInteger(newTotalCents) || newTotalCents < 0) {
      throw new ApiException(ErrorCode.VAL_001, 'السعر الجديد غير صالح', HttpStatus.BAD_REQUEST);
    }
    if (order.depositAmountCents !== null && newTotalCents < order.depositAmountCents) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        'السعر الجديد أقل من الإيداع المثبّت على الطلب',
        HttpStatus.CONFLICT,
      );
    }

    const [commitment] = await manager.query<
      { has_payment: boolean; has_installment_application: boolean }[]
    >(
      `SELECT
         EXISTS (
           SELECT 1 FROM payments
           WHERE order_id = $1
             AND payment_status IN ('pending','processing','succeeded','partially_refunded','refunded')
         ) AS has_payment,
         EXISTS (
           SELECT 1 FROM installment_applications
           WHERE order_id = $1 AND status IN ('pending_review','approved') AND deleted_at IS NULL
         ) AS has_installment_application`,
      [order.id],
    );
    if (commitment?.has_payment || commitment?.has_installment_application) {
      throw new ApiException(
        ErrorCode.ORDR_003,
        'بدأ التزام دفع على الطلب — استخدم مسار تحصيل إضافي أو استرداد بدل تعديل السعر مباشرة',
        HttpStatus.CONFLICT,
      );
    }

    const previousTotalCents = order.totalAmountCents;
    const previousCommissionableBaseCents = order.commissionableBaseCents;
    const deltaCents = newTotalCents - previousTotalCents;
    order.totalAmountCents = newTotalCents;
    if (order.commissionableBaseCents !== null) {
      order.commissionableBaseCents = Math.max(0, order.commissionableBaseCents + deltaCents);
    }
    await manager.save(order);

    return {
      previousTotalCents,
      newTotalCents,
      previousCommissionableBaseCents,
      newCommissionableBaseCents: order.commissionableBaseCents,
    };
  }
}
