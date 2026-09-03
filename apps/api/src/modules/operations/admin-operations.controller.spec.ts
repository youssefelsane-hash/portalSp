import { AdminOperationsController } from './admin-operations.controller';
import { DispatchDeliveryQueryDto } from './dto/dispatch-delivery-query.dto';
import { LiveDispatchQueryDto } from './dto/live-dispatch-query.dto';
import { ExceptionCenterQueryDto } from './dto/exception-center-query.dto';
import { MatchingWorkflowState } from '../matching/matching-workflow-state';

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


/**
 * نفس فئة بَقّة §90 فوق، مطبَّقة على الـendpoints الجديدة **قبل** ما البَقّة تحصل: كل الحقول
 * اللي الواجهة بتعتمد عليها بتعدّي من mapping يدوي هنا، وأي حقل مفقود بيختفي من الـJSON في صمت
 * تام — الـtypecheck مابيمسكهوش لأن الرد مبني بـobject literal حر.
 */
function workflow(over: Partial<MatchingWorkflowState> = {}): MatchingWorkflowState {
  return { phase: 'round_expansion_due', nextActionAt: new Date('2026-09-03T10:00:00.000Z'), delaySeconds: 900, isDelayed: true, ...over };
}

function controllerWith(dispatchDeliveryService: unknown, exceptionCenterService: unknown = {}) {
  return new AdminOperationsController(
    {} as never,
    {} as never,
    dispatchDeliveryService as never,
    exceptionCenterService as never,
    {} as never,
  );
}

describe('AdminOperationsController.getLiveDispatch() — mapping التحكم اللحظي', () => {
  const serviceResult = {
    totalSearching: 340,
    truncated: true,
    items: [
      {
        orderId: 'order-1',
        orderNumber: 'ORD-000900',
        serviceNameAr: 'سباكة',
        bookingMode: 'individual',
        orderType: 'standard',
        searchingSinceSeconds: 4200,
        currentRound: 2,
        maxRounds: 4,
        techniciansContacted: 5,
        pending: 3,
        viewed: 1,
        rejected: 1,
        accepted: 0,
        workflow: workflow(),
      },
    ],
  };

  it('بيمرّر كل حقل بتقراه الواجهة — بما فيهم النص العربي للمرحلة', async () => {
    const controller = controllerWith({ getLiveDispatch: jest.fn().mockResolvedValue(serviceResult) });
    const result = await controller.getLiveDispatch({} as LiveDispatchQueryDto);

    expect(result.orders.items[0]).toEqual({
      order_id: 'order-1',
      order_number: 'ORD-000900',
      service_name_ar: 'سباكة',
      booking_mode: 'individual',
      order_type: 'standard',
      searching_since_seconds: 4200,
      current_round: 2,
      max_rounds: 4,
      technicians_contacted: 5,
      pending: 3,
      viewed: 1,
      rejected: 1,
      accepted: 0,
      workflow_phase: 'round_expansion_due',
      // النص جاي من الباك-إند عشان الواجهة ماتترجمش المرحلة بنفسها.
      workflow_phase_ar: 'توسيع البث لجولة جديدة',
      next_action_at: new Date('2026-09-03T10:00:00.000Z'),
      delay_seconds: 900,
      is_delayed: true,
    });
  });

  it('العدد الحقيقي وعلامة القصّ بيوصلوا للواجهة — مش بيتقطعوا في الرد', async () => {
    const controller = controllerWith({ getLiveDispatch: jest.fn().mockResolvedValue(serviceResult) });
    const result = await controller.getLiveDispatch({} as LiveDispatchQueryDto);

    // ده بالظبط اللي كان هيضيع لو `items`/`meta` اتحطّوا على المستوى الأول: ResponseInterceptor
    // بيفردهم لـ`data: items` ويقطع أي حقل جنبهم بصمت.
    expect(result.summary).toEqual({ total_searching: 340, truncated: true });
    expect(result.orders.items).toHaveLength(1);
  });

  it('الرد **مالوش** items/meta على المستوى الأول — وإلا ResponseInterceptor بيقطع summary', async () => {
    const controller = controllerWith({ getLiveDispatch: jest.fn().mockResolvedValue(serviceResult) });
    const result = await controller.getLiveDispatch({} as LiveDispatchQueryDto);

    expect(Object.keys(result).sort()).toEqual(['orders', 'summary']);
  });

  it('الفلاتر بتوصل للخدمة زي ما وصلت — بما فيها only_delayed', async () => {
    const getLiveDispatch = jest.fn().mockResolvedValue({ ...serviceResult, items: [] });
    const controller = controllerWith({ getLiveDispatch });
    await controller.getLiveDispatch({ category_id: 'cat-1', zone_id: 'zone-1', only_delayed: true } as LiveDispatchQueryDto);

    expect(getLiveDispatch).toHaveBeenCalledWith({ categoryId: 'cat-1', zoneId: 'zone-1', onlyDelayed: true });
  });
});

describe('AdminOperationsController.getExceptions() — البنود الأربعة كلها بتوصل', () => {
  it('بيمرّر overdue_orders وmatching_workflow_delayed مع البندين القدام', async () => {
    const exceptionCenterService = {
      getExceptions: jest.fn().mockResolvedValue({
        overdueOrders: {
          items: [
            {
              orderId: 'o1',
              orderNumber: 'ORD-1',
              scheduledAt: '2026-09-01T08:00:00.000Z',
              technicianId: 't1',
              technicianCode: 'TECH-1',
              fullName: 'فني',
              daysLate: 2,
            },
          ],
          total: 1,
        },
        matchingWorkflowDelayed: {
          items: [
            {
              orderId: 'o2',
              orderNumber: 'ORD-2',
              orderStatus: 'searching_technician',
              currentRound: 1,
              maxRounds: 4,
              techniciansContacted: 2,
              pendingResponses: 2,
              expectedActionAt: '2026-09-03T09:00:00.000Z',
              delaySeconds: 900,
            },
          ],
          total: 1,
        },
        crewShortage: { items: [], total: 0 },
        staleDispatch: { items: [], total: 0 },
      }),
    };
    const controller = controllerWith({}, exceptionCenterService);
    const result = await controller.getExceptions({} as ExceptionCenterQueryDto);

    expect(result.overdue_orders.items[0]).toMatchObject({ order_number: 'ORD-1', days_late: 2 });
    expect(result.matching_workflow_delayed.items[0]).toMatchObject({
      order_number: 'ORD-2',
      current_round: 1,
      max_rounds: 4,
      technicians_contacted: 2,
      pending_responses: 2,
      delay_seconds: 900,
    });
  });
});
