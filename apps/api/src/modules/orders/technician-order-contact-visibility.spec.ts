import { TechnicianOrderExecutionController } from './technician-order-execution.controller';
import { BookingMode, Order, OrderStatus } from './entities/order.entity';

describe('TechnicianOrderExecutionController customer contact visibility', () => {
  const contact = { name: 'عميل مؤكد', phone: '+201001234567' };
  const customerProfiles = { findContactInfoOrThrow: jest.fn().mockResolvedValue(contact) };

  function order(status: OrderStatus): Order {
    return Object.assign(new Order(), {
      id: '00000000-0000-4000-8000-000000000001',
      orderNumber: 'ORD-CONTACT-1',
      serviceId: '00000000-0000-4000-8000-000000000002',
      addressId: '00000000-0000-4000-8000-000000000003',
      customerId: '00000000-0000-4000-8000-000000000004',
      technicianId: '00000000-0000-4000-8000-000000000005',
      orderType: 'standard',
      bookingMode: BookingMode.INDIVIDUAL,
      orderStatus: status,
      problemDescription: null,
      customerNotes: null,
      scheduledAt: null,
      scheduledEndAt: null,
      estimatedPriceCents: null,
      inspectionFeeCents: 0,
      surgeAmountCents: 0,
      discountAmountCents: 0,
      promoCodeId: null,
      totalAmountCents: 10000,
      warrantyPlanId: null,
      warrantyPriceCents: 0,
      warrantyPlanSnapshot: null,
      depositAmountCents: null,
      paymentStatus: 'pending',
      placedAt: null,
      cancelledAt: null,
      cancellationReasonId: null,
      cancellationFeeCents: 0,
      warrantyExpiresAt: null,
      parentOrderId: null,
      buildingId: null,
      recurringTemplateId: null,
      recurringOccurrenceAt: null,
      standardDataId: null,
      requiredTechnicians: null,
      requiredAssistants: null,
      estimatedDurationDays: null,
      pricingQuantity: null,
      requestedTechnicianId: null,
      requestedTechnicianCompanyId: null,
      customerCashConfirmedAt: null,
      technicianCashNotReceivedAt: null,
      createdAt: new Date('2026-08-25T00:00:00.000Z'),
    });
  }

  function controller(current: Order): TechnicianOrderExecutionController {
    return new TechnicianOrderExecutionController(
      {
        findVisibleForTechnician: jest.fn().mockResolvedValue(current),
        // docs/08 §56 بند 2 — getOne بتعلّم الطلب "اتفتح" بعد ما تبني الرد.
        markViewedByTechnician: jest.fn().mockResolvedValue(undefined),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findByIdOrThrow: jest.fn().mockResolvedValue({
          streetName: 'شارع الاختبار',
          landmark: null,
          location: { coordinates: [31.2, 30.1] },
        }),
      } as never,
      customerProfiles as never,
      { findByUserIdOrThrow: jest.fn().mockResolvedValue({ id: current.technicianId }) } as never,
      {
        getCollectionBreakdownForOrder: jest.fn().mockResolvedValue({
          paidAmountCents: 0,
          directPaidAmountCents: 0,
          financedOrderAmountCents: 0,
          refundedAmountCents: 0,
          installmentOutstandingCents: 0,
          amountDueToTechnicianCents: 10000,
        }),
      } as never,
      { findServiceOrThrow: jest.fn().mockResolvedValue({ nameAr: 'خدمة اختبار' }) } as never,
      {} as never,
    );
  }

  beforeEach(() => customerProfiles.findContactInfoOrThrow.mockClear());

  it('shows the customer phone to the assigned technician after acceptance', async () => {
    const dto = await controller(order(OrderStatus.ACCEPTED)).getOne(
      { sub: 'technician-user' } as never,
      '00000000-0000-4000-8000-000000000001',
    );

    expect(dto).toMatchObject({ customer_name: contact.name, customer_phone: contact.phone });
    expect(customerProfiles.findContactInfoOrThrow).toHaveBeenCalledTimes(1);
  });

  it('does not expose the customer phone before the technician accepts', async () => {
    const dto = await controller(order(OrderStatus.TECHNICIAN_ASSIGNED)).getOne(
      { sub: 'technician-user' } as never,
      '00000000-0000-4000-8000-000000000001',
    );

    expect(dto.customer_phone).toBeUndefined();
    expect(customerProfiles.findContactInfoOrThrow).not.toHaveBeenCalled();
  });
});
