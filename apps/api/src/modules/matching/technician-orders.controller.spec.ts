import { Order, OrderPaymentStatus, OrderStatus, OrderType, BookingMode } from '../orders/entities/order.entity';
import { TechnicianOrdersController } from './technician-orders.controller';

const acceptedOrder = Object.assign(new Order(), {
  id: '01a00000-0000-7000-8000-000000000001',
  orderNumber: 'ORD-TEST-1',
  customerId: '01a00000-0000-7000-8000-000000000002',
  serviceId: '01a00000-0000-7000-8000-000000000003',
  addressId: '01a00000-0000-7000-8000-000000000004',
  technicianId: '01a00000-0000-7000-8000-000000000005',
  requestedTechnicianId: null,
  requestedTechnicianCompanyId: null,
  orderStatus: OrderStatus.ACCEPTED,
  orderType: OrderType.STANDARD,
  bookingMode: BookingMode.INDIVIDUAL,
  problemDescription: null,
  customerNotes: null,
  scheduledAt: new Date('2026-09-23T00:00:00Z'),
  scheduledEndAt: null,
  estimatedPriceCents: 1_010_000,
  inspectionFeeCents: 0,
  surgeAmountCents: 0,
  levelPremiumCents: 0,
  discountAmountCents: 0,
  promoCodeId: null,
  totalAmountCents: 1_010_000,
  warrantyPlanId: null,
  warrantyPriceCents: 0,
  warrantyPlanSnapshot: null,
  depositAmountCents: null,
  paymentStatus: OrderPaymentStatus.UNPAID,
  placedAt: new Date('2026-08-26T12:00:00Z'),
  cancelledAt: null,
  cancellationReasonId: null,
  cancellationFeeCents: 0,
  createdAt: new Date('2026-08-26T12:00:00Z'),
  warrantyExpiresAt: null,
  parentOrderId: null,
  buildingId: null,
  recurringTemplateId: null,
  recurringOccurrenceAt: null,
  standardDataId: null,
  requiredTechnicians: 1,
  requiredAssistants: 0,
  estimatedDurationDays: null,
  pricingQuantity: null,
  customerCashConfirmedAt: null,
  technicianCashNotReceivedAt: null,
});

describe('TechnicianOrdersController accepted-order response', () => {
  const matchingService = {
    accept: jest.fn().mockResolvedValue(acceptedOrder),
    acceptWorkOpportunity: jest.fn().mockResolvedValue(acceptedOrder),
  };
  const addressesService = {
    findByIdOrThrow: jest.fn().mockResolvedValue({
      streetName: 'شارع الاختبار',
      landmark: null,
      location: { type: 'Point', coordinates: [31, 30] },
    }),
  };
  const customerProfilesService = {
    findContactInfoOrThrow: jest.fn().mockResolvedValue({ name: 'عميل تجريبي', phone: '+201000000003' }),
  };
  const paymentsService = {
    getTechnicianMoneyView: jest.fn().mockResolvedValue({
      cashToCollectCents: 0,
      myEarningCents: 858_500,
      hasOnlinePayment: true,
      fullyPaidOnline: true,
    }),
  };
  const catalogService = {
    findServiceOrThrow: jest.fn().mockResolvedValue({ nameAr: 'تشطيب حمام' }),
  };
  const controller = new TechnicianOrdersController(
    matchingService as never,
    addressesService as never,
    customerProfilesService as never,
    paymentsService as never,
    catalogService as never,
  );

  it.each([
    ['قبول عرض عادي', () => controller.accept({ sub: 'tech-user' } as never, acceptedOrder.id)],
    [
      'قبول فرصة شغل إضافي',
      () => controller.acceptWorkOpportunity({ sub: 'tech-user' } as never, '01a00000-0000-7000-8000-000000000099'),
    ],
  ])('%s يرجع نصيب الفني المحسوب بدل حقل غائب يتحول لصفر', async (_label, invoke) => {
    const result = await invoke();
    expect(result.my_earning_cents).toBe(858_500);
    expect(result.cash_to_collect_cents).toBe(0);
    expect(result.fully_paid_online).toBe(true);
    expect(result.customer_name).toBe('عميل تجريبي');
    expect(result.service_name_ar).toBe('تشطيب حمام');
    // docs/08 §108-B — total_amount_cents اتشال من TechnicianOrderResponseDto خالص (مش موجود
    // كنوع أصلًا دلوقتي)؛ التغطية الكاملة لعقد الفني المالي في technician-order-response.spec.ts.
  });
});
