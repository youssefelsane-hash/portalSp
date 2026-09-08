import { PaymentsService } from './payments.service';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { OrderStatus } from '../orders/entities/order.entity';
import { crewEarningsServiceStub } from './crew-earnings.testing';

describe('PaymentsService — unknown provider-registration outcome', () => {
  const makeService = (options?: { existingPayment?: Payment; createPayment?: () => Promise<never> }) => {
    const paymentRepository = {
      findOne: jest.fn().mockResolvedValue(options?.existingPayment ?? null),
      save: jest.fn().mockImplementation(async (payment: Payment) => payment),
    };
    const provider = {
      isConfigured: true,
      createPayment: jest.fn(options?.createPayment ?? (() => Promise.reject(new Error('gateway timeout')))),
    };
    const paymentProviders = {
      getProvider: jest.fn().mockReturnValue(provider),
    };
    const service = new PaymentsService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'order-1',
          customerId: 'customer-1',
          orderStatus: OrderStatus.PENDING_PAYMENT,
          totalAmountCents: 100000,
        }),
      } as never,
      paymentRepository as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'user-1', fullName: 'عميل اختبار', email: null, phoneNumber: '+201000000000' }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findByUserIdOrThrow: jest.fn().mockResolvedValue({ id: 'customer-1', userId: 'user-1' }),
        findByProfileIdOrThrow: jest.fn().mockResolvedValue({ id: 'customer-1', userId: 'user-1' }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getNumber: jest.fn() } as never,
      {} as never,
      {} as never,
      paymentProviders as never,
      {} as never,
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
    );
    return { service, paymentRepository, provider, paymentProviders };
  };

  it('الـtimeout لا يتحول إلى FAILED؛ يصبح مراجعة مالية صريحة لحين webhook أو reconciliation', async () => {
    const payment = {
      id: 'payment-1',
      customerId: 'customer-1',
      orderId: 'order-1',
      amountCents: 100000,
      paymentStatus: PaymentGatewayStatus.PENDING,
      failureCode: null,
      failureMessage: null,
      gatewayReference: null,
      gatewayResponse: null,
    } as Payment;
    const { service, paymentRepository } = makeService();
    (service as unknown as { orders: { findOne: jest.Mock } }).orders.findOne = jest.fn().mockResolvedValue({ orderNumber: 'ORD-1' });

    await expect(
      (service as unknown as { initiateProviderCharge: (p: Payment, method: PaymentMethod) => Promise<unknown> }).initiateProviderCharge(
        payment,
        PaymentMethod.CARD,
      ),
    ).rejects.toThrow('gateway timeout');

    expect(payment.paymentStatus).toBe(PaymentGatewayStatus.MANUAL_REVIEW);
    expect(payment.failureCode).toBe('GATEWAY_REGISTRATION_OUTCOME_UNKNOWN');
    expect(paymentRepository.save).toHaveBeenCalledWith(payment);
  });

  it('لا يعيد إنشاء عملية دفع عند إعادة نفس Idempotency-Key وهي تحت مراجعة مالية', async () => {
    const existing = {
      id: 'payment-1',
      orderId: 'order-1',
      paymentStatus: PaymentGatewayStatus.MANUAL_REVIEW,
      gatewayResponse: null,
    } as Payment;
    const { service, provider } = makeService({ existingPayment: existing });

    await expect(
      (service as unknown as {
        payWithProvider: (userId: string, orderId: string, idempotencyKey: string, method: PaymentMethod) => Promise<unknown>;
      }).payWithProvider('user-1', 'order-1', 'same-idempotency-key', PaymentMethod.CARD),
    ).rejects.toThrow('تحتاج مراجعة مالية');

    expect(provider.createPayment).not.toHaveBeenCalled();
  });
});
