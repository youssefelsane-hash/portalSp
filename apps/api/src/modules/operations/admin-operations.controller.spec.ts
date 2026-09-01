import { AdminOperationsController } from './admin-operations.controller';
import { DispatchDeliveryQueryDto } from './dto/dispatch-delivery-query.dto';

// بَقّة حقيقية اتلقطت بلقطة شاشة مالك (docs/08 §90): AdminDispatchDeliveryService كانت بترجّع
// orderNumber/orderTechnicianCount صح (اختبارات admin-dispatch-delivery.spec.ts بتغطّي ده)،
// والواجهة (apps/admin) كانت بتقرا order_number/order_technician_count صح — لكن الـmapping هنا
// في الـcontroller نسي الحقلين، فكانوا بيوصلوا JSON بلا أي أثر ليهم خالص. اختبار على مستوى
// الـservice بس ما كانش يقدر يمسك البَقّة دي، لأنها في طبقة التحويل للـJSON مش في حساب الرقم
// نفسه — عمدًا اختبار على مستوى الـcontroller عشان يقفل نفس الفجوة تاني في المستقبل.
describe('AdminOperationsController.getDispatchDelivery() — تمرير order_number/order_technician_count', () => {
  it('بيمرّر orderNumber/orderTechnicianCount من الخدمة كـorder_number/order_technician_count في الرد', async () => {
    const dispatchDeliveryService = {
      getDeliveryObservability: jest.fn().mockResolvedValue({
        summary: {
          assignments: { sent: 0, viewed: 0, accepted: 0, rejected: 0, timeout: 0, cancelled: 0, staleSentCount: 0 },
          workOpportunities: { offered: 0, accepted: 0, declined: 0, closed: 0 },
        },
        feed: {
          items: [
            {
              id: 'row-1',
              kind: 'assignment',
              orderId: 'order-1',
              technicianId: 'tech-1',
              technicianCode: 'TECH-000001',
              fullName: 'فني اختبار',
              status: 'sent',
              context: null,
              sentAt: '2026-08-28T10:00:00.000Z',
              respondedAt: null,
              expiresAt: null,
              isStale: false,
              orderNumber: 'ORD-000123',
              orderTechnicianCount: 3,
            },
          ],
          meta: { page: 1, perPage: 20, totalCount: 1 },
        },
      }),
    };

    const controller = new AdminOperationsController(
      {} as never,
      {} as never,
      dispatchDeliveryService as never,
      {} as never,
      {} as never,
    );

    const result = await controller.getDispatchDelivery({ hours: 24, page: 1, per_page: 20 } as DispatchDeliveryQueryDto);

    expect(result.feed.items[0]).toMatchObject({
      order_number: 'ORD-000123',
      order_technician_count: 3,
    });
  });
});
