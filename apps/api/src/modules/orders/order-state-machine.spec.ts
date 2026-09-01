import {
  ACTIVE_TECHNICIAN_ORDER_STATUSES,
  CUSTOMER_CANCELLABLE_STATUSES,
  TECHNICIAN_CONTACT_VISIBLE_STATUSES,
  canTransition,
  ORDER_TRANSITIONS,
} from './order-state-machine';
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

// docs/08 §22 بند 1 — تليفون الفني لازم يظهر للعميل بس بعد "تأكيد حجيز حقيقي" (الفني وافق فعليًا،
// مش بس اتعيّن وينتظر قبوله). اختبار وحدة نقي بيثبت إن مجموعة الحالات دي بالظبط، صفر حالة سابقة
// لـACCEPTED مسموحة (تسريب رقم فني لعميل قبل ما الفني يوافق أصلاً)، وصفر حالة إلغاء/نزاع نهائية.
describe('order-state-machine — TECHNICIAN_CONTACT_VISIBLE_STATUSES (docs/08 §22 بند 1)', () => {
  const preConfirmationStatuses = [
    OrderStatus.DRAFT,
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.TECHNICIAN_ASSIGNED, // الفني اتعيّن بس لسه ما وافقش — أهم حالة لازم تترفض
  ];

  it('صفر حالة "قبل التأكيد" موجودة في مجموعة الظهور — الفني المُعيّن (مش المُوافِق) لازم يترفض', () => {
    for (const status of preConfirmationStatuses) {
      expect(TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(status)).toBe(false);
    }
  });

  it('صفر حالة إلغاء/نزاع/انتظار-إعادة-اختيار موجودة — الفني القديم متسربش بعد إلغاء/تنازع', () => {
    const terminalOrDisputedStatuses = [
      OrderStatus.CANCELLED_BY_CUSTOMER,
      OrderStatus.CANCELLED_BY_TECHNICIAN,
      OrderStatus.CANCELLED_BY_SYSTEM,
      OrderStatus.EXPIRED,
      OrderStatus.DISPUTED,
      OrderStatus.REFUNDED,
      OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
    ];
    for (const status of terminalOrDisputedStatuses) {
      expect(TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(status)).toBe(false);
    }
  });

  it('ACCEPTED فصاعدًا (لحد الاكتمال) — الحالات اللي الفني ملتزم فيها فعليًا، لازم تظهر', () => {
    for (const status of [
      OrderStatus.ACCEPTED,
      OrderStatus.TECHNICIAN_ON_WAY,
      OrderStatus.TECHNICIAN_ARRIVED,
      OrderStatus.IN_PROGRESS,
      OrderStatus.AWAITING_QUOTE_APPROVAL,
      OrderStatus.WORK_COMPLETED,
      OrderStatus.AWAITING_PAYMENT,
      OrderStatus.COMPLETED,
    ]) {
      expect(TECHNICIAN_CONTACT_VISIBLE_STATUSES.has(status)).toBe(true);
    }
  });
});

describe('order-state-machine — active technician resource', () => {
  it('keeps the technician busy while an in-progress job waits for quote approval', () => {
    expect(ACTIVE_TECHNICIAN_ORDER_STATUSES).toContain(OrderStatus.AWAITING_QUOTE_APPROVAL);
    expect(canTransition(OrderStatus.IN_PROGRESS, OrderStatus.AWAITING_QUOTE_APPROVAL)).toBe(true);
    expect(canTransition(OrderStatus.AWAITING_QUOTE_APPROVAL, OrderStatus.IN_PROGRESS)).toBe(true);
  });

  it('releases the active-work resource once field work is complete', () => {
    expect(ACTIVE_TECHNICIAN_ORDER_STATUSES).not.toContain(OrderStatus.WORK_COMPLETED);
    expect(ACTIVE_TECHNICIAN_ORDER_STATUSES).not.toContain(OrderStatus.AWAITING_PAYMENT);
    expect(ACTIVE_TECHNICIAN_ORDER_STATUSES).not.toContain(OrderStatus.COMPLETED);
  });
});

describe('order-state-machine — تسعير الإدارة من الصور', () => {
  it('يحافظ على الطلب خارج المطابقة لحد ما الإدارة ترسل السعر والعميل يوافق', () => {
    expect(canTransition(OrderStatus.AWAITING_ADMIN_QUOTE, OrderStatus.SEARCHING_TECHNICIAN)).toBe(false);
    expect(canTransition(OrderStatus.AWAITING_ADMIN_QUOTE, OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL)).toBe(true);
    expect(canTransition(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL, OrderStatus.SEARCHING_TECHNICIAN)).toBe(true);
  });

  it('يسمح للعميل بالإلغاء قبل السعر أو برفض السعر بعد وصوله', () => {
    expect(CUSTOMER_CANCELLABLE_STATUSES.has(OrderStatus.AWAITING_ADMIN_QUOTE)).toBe(true);
    expect(CUSTOMER_CANCELLABLE_STATUSES.has(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL)).toBe(true);
    expect(canTransition(OrderStatus.AWAITING_ADMIN_QUOTE, OrderStatus.CANCELLED_BY_CUSTOMER)).toBe(true);
    expect(canTransition(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL, OrderStatus.CANCELLED_BY_CUSTOMER)).toBe(true);
  });
});
