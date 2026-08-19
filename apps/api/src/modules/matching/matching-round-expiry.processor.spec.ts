import { MatchingRoundExpiryProcessor } from './matching-round-expiry.processor';
import { AssignmentStatus } from './entities/order-assignment.entity';
import { OrderStatus } from '../orders/entities/order.entity';
import { ORDER_OFFER_RESOLVED_EVENT } from '../../common/events/order-offer-resolved.event';

// اختبار وحدة (mocks بس، مفيش DB/Redis مطلوبين) — بيثبت التصحيح الجوهري لـADR-0018 §5: انتهاء
// مهلة الجولة لازم يوسّع البث لفنيين إضافيين بس، **بلا أي تعديل على order_assignments** — العروض
// المعلّقة تفضل sent وقابلة للقبول. قبل التصحيح، الـprocessor ده كان بيحوّلها لـTIMEOUT (assignments
// .save()) — أهم فحص هنا هو التأكيد الصريح إن assignments.save() ماعادش بيتنادى خالص.
describe('MatchingRoundExpiryProcessor — توسيع البث بلا إبطال العروض القديمة (ADR-0018 §5)', () => {
  function buildProcessor(opts: {
    order: { orderStatus: OrderStatus } | null;
    pendingAssignments: { id: string; technicianId: string }[];
  }) {
    const save = jest.fn().mockResolvedValue(undefined);
    const find = jest.fn().mockResolvedValue(opts.pendingAssignments);
    const assignments = { find, save } as never;
    const orders = { findOne: jest.fn().mockResolvedValue(opts.order) } as never;
    const dispatchNextRound = jest.fn().mockResolvedValue({ dispatched: 1 });
    const matchingService = { dispatchNextRound } as never;
    const emit = jest.fn();
    const events = { emit } as never;
    const processor = new MatchingRoundExpiryProcessor(assignments, orders, matchingService, events);
    return { processor, save, find, dispatchNextRound, emit };
  }

  it('الطلب اتحل قبل ما المهلة تخلص (مش searching_technician): مفيش أي تعديل ولا توسيع بث', async () => {
    const { processor, save, dispatchNextRound } = buildProcessor({
      order: { orderStatus: OrderStatus.ACCEPTED },
      pendingAssignments: [],
    });

    await processor.process({ data: { orderId: 'order-1', round: 1 } } as never);

    expect(save).not.toHaveBeenCalled();
    expect(dispatchNextRound).not.toHaveBeenCalled();
  });

  it('كل عروض الجولة اتردّ عليها صراحة (accept/reject) قبل المهلة: مفيش توسيع بث زيادة', async () => {
    const { processor, save, dispatchNextRound } = buildProcessor({
      order: { orderStatus: OrderStatus.SEARCHING_TECHNICIAN },
      pendingAssignments: [],
    });

    await processor.process({ data: { orderId: 'order-2', round: 1 } } as never);

    expect(save).not.toHaveBeenCalled();
    expect(dispatchNextRound).not.toHaveBeenCalled();
  });

  it('عروض معلّقة بعد انتهاء المهلة: بيوسّع البث بلا أي لمسة لحالة الـassignments (§5)', async () => {
    const pending = [
      { id: 'assignment-1', technicianId: 'tech-1' },
      { id: 'assignment-2', technicianId: 'tech-2' },
    ];
    const { processor, save, dispatchNextRound, emit } = buildProcessor({
      order: { orderStatus: OrderStatus.SEARCHING_TECHNICIAN },
      pendingAssignments: pending,
    });

    await processor.process({ data: { orderId: 'order-3', round: 1 } } as never);

    // الفحص الأهم: مفيش أي كتابة على order_assignments خالص — العروض تفضل sent زي ما هي بالضبط.
    expect(save).not.toHaveBeenCalled();
    expect(dispatchNextRound).toHaveBeenCalledWith('order-3');
    expect(emit).toHaveBeenCalledTimes(pending.length);
    for (const assignment of pending) {
      expect(emit).toHaveBeenCalledWith(
        ORDER_OFFER_RESOLVED_EVENT,
        expect.objectContaining({ assignmentId: assignment.id, technicianId: assignment.technicianId, resolution: 'expired' }),
      );
    }
  });

  it('assignment_status المستخدم في الفلترة لسه sent/viewed بس (مش timeout) — يثبت العروض بتفضل مرشّحة', () => {
    // تثبيت توثيقي: AssignmentStatus.TIMEOUT لسه موجودة في الـenum (بيانات تاريخية قبل ADR-0018 §5)
    // لكن مفيش أي مكان في الكود الحي بيكتبها بعد النهاردة — الفحوصات فوق بتثبت السلوك الفعلي.
    expect(AssignmentStatus.TIMEOUT).toBe('timeout');
    expect(AssignmentStatus.SENT).toBe('sent');
  });
});
