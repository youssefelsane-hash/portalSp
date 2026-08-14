import { CUSTOMER_CANCELLABLE_STATUSES, canTransition, ORDER_TRANSITIONS } from './order-state-machine';
import { OrderStatus } from './entities/order.entity';

// اختبار وحدة نقي (بدون DB) — بيثبت إصلاح بَقّة حقيقية اتلقطت حيًا (docs/08 §19 بند 1):
// PENDING_PAYMENT كانت مُدرجة في CUSTOMER_CANCELLABLE_STATUSES (تدّعي إن العميل يقدر يلغيها)
// بس ORDER_TRANSITIONS[PENDING_PAYMENT] معندهاش CANCELLED_BY_CUSTOMER خالص — يعني أي محاولة
// إلغاء فعلية كانت بترفض بـORDR_003 "انتقال حالة غير مسموح" رغم إن الواجهة بتقول العكس. اتأكدت
// حيًا بـflutter test test_live/pending_payment_order_creation_live_test.dart (POST /orders/:id/cancel
// رجّع 409 حقيقي لطلب pending_payment حقيقي) قبل ما تتصلح.
describe('order-state-machine — اتساق CUSTOMER_CANCELLABLE_STATUSES مع ORDER_TRANSITIONS', () => {
  it('كل حالة في CUSTOMER_CANCELLABLE_STATUSES لازم يكون CANCELLED_BY_CUSTOMER فعليًا انتقال مسموح ليها — يمنع تكرار نفس فئة البَقّة لأي حالة جديدة تتضاف مستقبلاً', () => {
    for (const status of CUSTOMER_CANCELLABLE_STATUSES) {
      expect(canTransition(status, OrderStatus.CANCELLED_BY_CUSTOMER)).toBe(true);
    }
  });

  it('PENDING_PAYMENT تحديدًا (البَقّة اللي اتصلحت) — canTransition لـCANCELLED_BY_CUSTOMER بقى true', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED_BY_CUSTOMER)).toBe(true);
  });

  it('PENDING_PAYMENT لسه بتحافظ على باقي انتقالاتها الأصلية (regression — الإصلاح إضافة بس، مش استبدال)', () => {
    expect(ORDER_TRANSITIONS[OrderStatus.PENDING_PAYMENT]).toEqual(
      expect.arrayContaining([OrderStatus.SEARCHING_TECHNICIAN, OrderStatus.CANCELLED_BY_SYSTEM, OrderStatus.EXPIRED]),
    );
  });
});
