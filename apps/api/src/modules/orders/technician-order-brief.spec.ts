// docs/08 §56 بند 3 — بيانات العميل/الخدمة في مسارات الفني. بلاغ مالك بسكرين شوت: شاشة الطلب
// عند الفني فيها أزرار التنفيذ بس، بلا اسم العميل ولا تليفونه ولا اسم الخدمة. الاختبار ده
// بيثبّت الحقول الجديدة **وسياسة إخفائها** قبل تأكيد الحجز — الجزء الأمني هو الأهم هنا.
import { toOrderResponseDto } from './dto/order-response.dto';
import { Order } from './entities/order.entity';
import { OrderStatus } from './entities/order.entity';
import { TECHNICIAN_CONTACT_VISIBLE_STATUSES } from './order-state-machine';

function fakeOrder(orderStatus: OrderStatus): Order {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    orderNumber: 'ORD-1',
    serviceId: '00000000-0000-0000-0000-000000000002',
    addressId: '00000000-0000-0000-0000-000000000003',
    customerId: '00000000-0000-0000-0000-000000000004',
    technicianId: null,
    orderType: 'standard',
    bookingMode: 'individual',
    requestedTechnicianId: null,
    requestedTechnicianCompanyId: null,
    orderStatus,
    problemDescription: 'الحنفية بتنقّط',
    customerNotes: null,
    scheduledAt: null,
    scheduledEndAt: null,
    estimatedPriceCents: null,
    inspectionFeeCents: 0,
    surgeAmountCents: 0,
    discountAmountCents: 0,
    promoCodeId: null,
    totalAmountCents: 30000,
    warrantyPlanId: null,
    warrantyPriceCents: 0,
    warrantyPlanSnapshot: null,
    depositAmountCents: null,
    paymentStatus: 'pending',
    placedAt: null,
    cancelledAt: null,
    cancellationReasonId: null,
    cancellationFeeCents: 0,
    createdAt: new Date(),
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
    customerCashConfirmedAt: null,
    technicianCashNotReceivedAt: null,
  } as unknown as Order;
}

describe('toOrderResponseDto — بيانات العميل/الخدمة للفني (docs/08 §56 بند 3)', () => {
  const contact = { name: 'يوسف السنى', phone: '+201000000000' };

  it('بيمرّر اسم/تليفون العميل واسم الخدمة لما الكولر يبعتهم', () => {
    const dto = toOrderResponseDto(fakeOrder(OrderStatus.ACCEPTED), null, null, {
      customerContact: contact,
      serviceNameAr: 'تسليك مواسير',
    });
    expect(dto.customer_name).toBe('يوسف السنى');
    expect(dto.customer_phone).toBe('+201000000000');
    expect(dto.service_name_ar).toBe('تسليك مواسير');
    // وصف المشكلة كان موجود من الأصل — بيتأكد إنه مش اتكسر مع الإضافة.
    expect(dto.problem_description).toBe('الحنفية بتنقّط');
  });

  it('اسم الخدمة بيظهر حتى بلا بيانات تواصل (مش بيانات شخصية)', () => {
    const dto = toOrderResponseDto(fakeOrder(OrderStatus.SEARCHING_TECHNICIAN), null, null, {
      customerContact: null,
      serviceNameAr: 'تسليك مواسير',
    });
    expect(dto.service_name_ar).toBe('تسليك مواسير');
    expect(dto.customer_name).toBeUndefined();
    expect(dto.customer_phone).toBeUndefined();
  });

  it('المسارات القديمة (بلا viewerExtras) مابترجّعش الحقول الجديدة — صفر تسريب لأي كولر ما طلبهاش', () => {
    const dto = toOrderResponseDto(fakeOrder(OrderStatus.ACCEPTED));
    expect(dto.customer_name).toBeUndefined();
    expect(dto.customer_phone).toBeUndefined();
    expect(dto.service_name_ar).toBeUndefined();
  });

  it('سياسة الظهور مرآة حرفية لبيانات الفني عند العميل — نفس المجموعة بالظبط', () => {
    // الحالات اللي الفني بيشوف فيها العميل = الحالات اللي العميل بيشوف فيها الفني. لو حد غيّر
    // المجموعة دي في ناحية واحدة بس، الاختبار ده بيقع.
    expect(TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(OrderStatus.ACCEPTED)).toBe(true);
    expect(TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(OrderStatus.SEARCHING_TECHNICIAN)).toBe(false);
    expect(TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(OrderStatus.PENDING_PAYMENT)).toBe(false);
  });
});
