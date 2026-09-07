import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { RECURRING_CARD_PAYMENT_FAILED_EVENT } from '../../common/events/recurring-order-payment.event';
import { PaymentGatewayStatus } from '../payments/entities/payment.entity';
import { PaymentsService } from '../payments/payments.service';
import { RecurringOrdersService } from './recurring-orders.service';

describe('RecurringOrdersService — تحصيل بطاقة الحجز المتكرر', () => {
  function buildService(query: jest.Mock, chargeResult: { status: PaymentGatewayStatus; failureReason: string | null }) {
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const payments = {
      attemptRecurringOrderCardCharge: jest.fn().mockResolvedValue(chargeResult),
    } as unknown as PaymentsService;
    const service = new RecurringOrdersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      eventEmitter,
      {} as never,
      { query } as unknown as DataSource,
      payments,
    );
    return { service, eventEmitter, payments };
  }

  it('يراجع البطاقة مرة واحدة ثم يجدول المحاولة التالية عند الرفض', async () => {
    const claimed = {
      id: 'order-1',
      order_number: 'ORD-TEST-1',
      customer_id: 'customer-1',
      scheduled_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      total_amount_cents: 45000,
      attempt_number: 1,
    };
    const query = jest.fn().mockResolvedValueOnce([[claimed], 1]).mockResolvedValueOnce([]);
    const { service, eventEmitter, payments } = buildService(query, {
      status: PaymentGatewayStatus.FAILED,
      failureReason: 'الرصيد غير كافٍ',
    });

    await (service as unknown as { sweepRecurringPaymentCollection(): Promise<void> }).sweepRecurringPaymentCollection();

    expect(payments.attemptRecurringOrderCardCharge).toHaveBeenCalledWith('order-1', 1);
    expect(query.mock.calls[1][0]).toContain('recurring_payment_next_attempt_at');
    expect(query.mock.calls[1][1]).toEqual(['order-1', 24, 24]);
    expect((eventEmitter.emit as jest.Mock)).toHaveBeenCalledWith(
      RECURRING_CARD_PAYMENT_FAILED_EVENT,
      expect.objectContaining({ orderId: 'order-1', attemptNumber: 1, cancelled: false }),
    );
  });

  it('لا يكرر السحب طالما نتيجة البوابة ما زالت قيد التأكيد', async () => {
    const claimed = {
      id: 'order-2',
      order_number: 'ORD-TEST-2',
      customer_id: 'customer-2',
      scheduled_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      total_amount_cents: 45000,
      attempt_number: 1,
    };
    const query = jest.fn().mockResolvedValueOnce([[claimed], 1]).mockResolvedValueOnce([]);
    const { service, eventEmitter, payments } = buildService(query, {
      status: PaymentGatewayStatus.PENDING,
      failureReason: null,
    });

    await (service as unknown as { sweepRecurringPaymentCollection(): Promise<void> }).sweepRecurringPaymentCollection();

    expect(payments.attemptRecurringOrderCardCharge).toHaveBeenCalledWith('order-2', 1);
    expect(query.mock.calls[1][0]).toContain('scheduled_at -');
    expect((eventEmitter.emit as jest.Mock)).not.toHaveBeenCalled();
  });
});
