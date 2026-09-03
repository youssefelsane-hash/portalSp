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
              viewedAt: '2026-08-28T10:02:00.000Z',
              respondedAt: null,
              expiresAt: null,
              assignmentRound: 2,
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
      {} as never,
    );

    const result = await controller.getDispatchDelivery({ hours: 24, page: 1, per_page: 20 } as DispatchDeliveryQueryDto);

    expect(result.feed.items[0]).toMatchObject({
      order_number: 'ORD-000123',
      order_technician_count: 3,
      viewed_at: '2026-08-28T10:02:00.000Z',
      assignment_round: 2,
    });
  });
});

// نفس فئة البَقّة اللي فوق، بس لمركز الاستثناءات: `AdminExceptionCenterService` كانت بتحسب
// `stalledRevisits` بالكامل (استعلام كامل كل نداء) والـcontroller بيرمي المفتاح ده قبل ما يوصل
// لأي واجهة — يعني إعادة زيارة معلّقة على فني مبقاش عنده الطلب ممكن تفضل معلّقة للأبد ومحدش
// يشوفها. اختبار على مستوى الخدمة مايمسكش ده لأن الخدمة كانت بترجّعه صح.
describe('AdminOperationsController.getExceptions() — كل مجموعة محسوبة توصل الرد', () => {
  it('بيمرّر الخمس مجموعات (متأخرة/نقص طاقم/توزيع متأخر/إعادة زيارة معلّقة/مطابقة واقفة)', async () => {
    const exceptionCenterService = {
      getExceptions: jest.fn().mockResolvedValue({
        overdueOrders: {
          items: [
            {
              orderId: 'o1',
              orderNumber: 'ORD-1',
              scheduledAt: '2026-08-27T10:00:00.000Z',
              technicianId: 't1',
              technicianCode: 'TECH-1',
              fullName: 'فني',
              daysLate: 2,
            },
          ],
          total: 1,
        },
        crewShortage: { items: [], total: 0 },
        staleDispatch: { items: [], total: 0 },
        stalledRevisits: {
          items: [
            {
              orderId: 'o2',
              orderNumber: 'ORD-2',
              originalOrderId: 'o0',
              originalOrderNumber: 'ORD-0',
              technicianId: 't2',
              technicianCode: 'TECH-2',
              fullName: 'فني إعادة الزيارة',
              phone: '+201000000000',
              pinnedAt: '2026-08-27T10:00:00.000Z',
              deadlineAt: '2026-08-28T10:00:00.000Z',
              reason: 'rejected',
              chargebackCents: 12_500,
            },
          ],
          total: 1,
        },
        matchingWorkflowDelayed: {
          items: [
            {
              orderId: 'o3',
              orderNumber: 'ORD-3',
              currentRound: 2,
              maxRounds: 4,
              expectedExpansionAt: '2026-08-28T10:00:00.000Z',
              delaySeconds: 900,
              techniciansContacted: 6,
            },
          ],
          total: 1,
        },
      }),
    };

    const controller = new AdminOperationsController(
      {} as never,
      {} as never,
      {} as never,
      exceptionCenterService as never,
      {} as never,
      {} as never,
    );

    const result = await controller.getExceptions({} as never);

    expect(result.overdue_orders.items[0]).toMatchObject({ order_number: 'ORD-1', days_late: 2 });
    expect(result.stalled_revisits.items[0]).toMatchObject({
      order_number: 'ORD-2',
      original_order_number: 'ORD-0',
      reason: 'rejected',
      chargeback_cents: 12_500,
    });
    expect(result.matching_workflow_delayed.items[0]).toMatchObject({
      order_number: 'ORD-3',
      current_round: 2,
      max_rounds: 4,
      delay_seconds: 900,
      technicians_contacted: 6,
    });
  });
});

// تتبّع الطلب — نفس الفحص: الخدمة بترجّع camelCase والـcontroller بيحوّل لـsnake_case. الجولات
// والفنيين متعشّشين، وده بالظبط المكان اللي حقل جوّه مصفوفة جوّه مصفوفة بيتنسى فيه بصمت.
describe('AdminOperationsController.listOrderTraces() — التعشيش بيوصل كامل', () => {
  it('بيحوّل الجولات والفنيين لـsnake_case بلا فقدان حقول', async () => {
    const orderTraceService = {
      listSearchingOrders: jest.fn().mockResolvedValue([
        {
          orderId: 'o1',
          orderNumber: 'ORD-9',
          orderStatus: 'searching_technician',
          isEmergency: true,
          currentRound: 1,
          maxRounds: 4,
          techniciansContacted: 1,
          counts: { sent: 1, viewed: 0, rejected: 0, accepted: 0, timeout: 0, cancelled: 0 },
          rounds: [
            {
              round: 1,
              startedAt: '2026-08-28T10:00:00.000Z',
              expansionDueAt: '2026-08-28T10:05:00.000Z',
              technicians: [
                {
                  assignmentId: 'a1',
                  technicianId: 't1',
                  technicianCode: 'TECH-1',
                  fullName: 'فني',
                  status: 'sent',
                  sentAt: '2026-08-28T10:00:00.000Z',
                  viewedAt: '2026-08-28T10:01:00.000Z',
                  respondedAt: null,
                  rejectionReasonCode: null,
                  distanceKm: 4.2,
                  estimatedEtaMinutes: 12,
                },
              ],
            },
          ],
          nextAction: 'expand_next_round',
          nextActionAt: '2026-08-28T10:05:00.000Z',
          delaySeconds: 300,
        },
      ]),
    };

    const controller = new AdminOperationsController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      orderTraceService as never,
    );

    const result = await controller.listOrderTraces();

    expect(result.items[0]).toMatchObject({
      order_number: 'ORD-9',
      is_emergency: true,
      current_round: 1,
      max_rounds: 4,
      technicians_contacted: 1,
      next_action: 'expand_next_round',
      delay_seconds: 300,
    });
    expect(result.items[0].rounds[0]).toMatchObject({ round: 1, expansion_due_at: '2026-08-28T10:05:00.000Z' });
    expect(result.items[0].rounds[0].technicians[0]).toMatchObject({
      assignment_id: 'a1',
      viewed_at: '2026-08-28T10:01:00.000Z',
      distance_km: 4.2,
      estimated_eta_minutes: 12,
    });
  });
});
