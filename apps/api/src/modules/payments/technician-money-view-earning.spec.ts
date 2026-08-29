import { PaymentsService } from './payments.service';
import { CrewEarningsService } from './crew-earnings.service';
import { CrewParticipant } from './crew-earning-split';
import { Order, OrderStatus, BookingMode } from '../orders/entities/order.entity';

/**
 * بلاغ المالك (docs/08 §64.ب): «فيه باجات كتيرة في السعر اللي بيظهر للصنايعي… بيقولوا إن نصيبك
 * من صفر، وده مش منطقي».
 *
 * التشخيص: الحساب نفسه سليم. `technicianEarning = commissionable_base − commission`، والأساس
 * بيرجع لـ`total_amount_cents` — والاتنين بصفر في طلب **لسه ما اتسعّرش** (معاينة/عرض سعر بيتحدد
 * على الطبيعة). يعني الرقم صح رياضيًا وكاذب معرفيًا: «0 ج.م» معناها للفني «هتشتغل ببلاش»،
 * والحقيقة «لسه ما اتحددش».
 *
 * وبَقّة تانية في نفس المنطقة اتلقطت وإحنا بنشخّص: عضو الطاقم كان بيشوف **وعاء القائد كله**
 * كأنه نصيبه هو (ADR-0040 وزّع الحصص في التسوية بس، والعرض فضل بيقرا الوعاء).
 */
describe('صورة فلوس الفني — «نصيبك» (docs/08 §64.ب)', () => {
  const LEADER = '00000000-0000-7000-8000-0000000000a1';
  const MEMBER = '00000000-0000-7000-8000-0000000000a2';

  function order(overrides: Partial<Order> = {}): Order {
    return Object.assign(new Order(), {
      id: '00000000-0000-7000-8000-0000000000b1',
      technicianId: LEADER,
      totalAmountCents: 100000,
      commissionableBaseCents: 100000,
      technicianEarningCents: 80000,
      orderStatus: OrderStatus.TECHNICIAN_ASSIGNED,
      bookingMode: BookingMode.INDIVIDUAL,
      ...overrides,
    });
  }

  function service(
    participants: CrewParticipant[],
    collection: {
      totalAmountCents?: number;
      directPaidAmountCents?: number;
      onlinePaidAmountCents?: number;
      amountDueToTechnicianCents?: number;
    } = {},
  ): PaymentsService {
    const svc = Object.create(PaymentsService.prototype) as PaymentsService;
    Object.assign(svc, {
      crewEarningsService: {
        resolveParticipants: async () => participants,
      } as unknown as CrewEarningsService,
      dataSource: { manager: {} },
      // المسار ده بيتنادى بس لما technician_earning_cents = 0 (طلب لسه ما اتقفلش) — وقتها
      // computeSettlement بتعيد الحساب من الخدمة والمستوى. أقل بدائل تخلّي الحساب حقيقي.
      catalogService: { findServiceForDisplay: async () => ({ commissionPercentage: 20, warrantyDays: 0 }) },
      techniciansService: { findByProfileIdOrThrow: async () => ({ currentLevel: 'professional' }) },
      technicianLevelsService: { getOrThrow: async () => ({ commissionAdjustmentPercentage: 0 }) },
      settingsService: { getNumber: async (_k: string, fallback: number) => fallback },
      getCollectionBreakdownForOrder: async () => ({
        totalAmountCents: collection.totalAmountCents ?? 100000,
        amountDueToTechnicianCents: collection.amountDueToTechnicianCents ?? 100000,
        paidAmountCents: 0,
        directPaidAmountCents: collection.directPaidAmountCents ?? 0,
        onlinePaidAmountCents: collection.onlinePaidAmountCents ?? 0,
        refundedAmountCents: 0,
        financedOrderAmountCents: 0,
        installmentOutstandingCents: 0,
      }),
    });
    return svc;
  }

  it('طلب متسعّر بلا طاقم: نصيبه = الوعاء كله، وearningPending = false', async () => {
    const view = await service([]).getTechnicianMoneyView(order());
    expect(view.myEarningCents).toBe(80000);
    expect(view.earningPending).toBe(false);
    expect(view.isCrewShare).toBe(false);
  });

  it('طلب لسه ما اتسعّرش: earningPending = true — التطبيق بيكتب «هيتحدد» مش «0 ج.م»', async () => {
    const view = await service([]).getTechnicianMoneyView(
      order({ totalAmountCents: 0, commissionableBaseCents: 0, technicianEarningCents: 0 }),
    );
    expect(view.myEarningCents).toBe(0);
    expect(view.earningPending).toBe(true);
  });

  it('صفر حقيقي مع سعر موجود مش بيتعلّم «لسه ما اتحددش» (الفرق بين الحالتين محفوظ)', async () => {
    const view = await service([]).getTechnicianMoneyView(
      // عمولة 100% — نصيب الفني صفر فعلاً، مش «لسه ما اتحددش».
      order({ technicianEarningCents: 0, commissionableBaseCents: 0, totalAmountCents: 100000 }),
    );
    expect(view.earningPending).toBe(false);
  });

  it('عضو الطاقم بيشوف **حصّته هو** مش وعاء القائد كله (ADR-0040)', async () => {
    const participants: CrewParticipant[] = [
      { technicianId: LEADER, participantRole: 'leader', technicianLevel: 'team_leader', shareWeight: 1.6 },
      { technicianId: MEMBER, participantRole: 'team_member', technicianLevel: 'new', shareWeight: 1 },
    ];
    const memberView = await service(participants).getTechnicianMoneyView(
      order({ bookingMode: BookingMode.TEAM }),
      undefined,
      MEMBER,
    );
    expect(memberView.isCrewShare).toBe(true);
    expect(memberView.myEarningCents).toBeLessThan(80000);
    // وزن 1 من إجمالي 2.6 على وعاء 80000 = 30769 (floor)
    expect(memberView.myEarningCents).toBe(Math.floor((80000 * 1) / 2.6));
  });

  it('عضو الطاقم لا يرى الكاش الذي حصّله قائد الطلب', async () => {
    const participants: CrewParticipant[] = [
      { technicianId: LEADER, participantRole: 'leader', technicianLevel: 'team_leader', shareWeight: 1.6 },
      { technicianId: MEMBER, participantRole: 'team_member', technicianLevel: 'new', shareWeight: 1 },
    ];
    const svc = service(participants, {
      directPaidAmountCents: 100000,
      amountDueToTechnicianCents: 0,
    });

    const leaderView = await svc.getTechnicianMoneyView(order({ bookingMode: BookingMode.TEAM }));
    const memberView = await svc.getTechnicianMoneyView(
      order({ bookingMode: BookingMode.TEAM }),
      undefined,
      MEMBER,
    );

    expect(leaderView.cashCollectedCents).toBe(100000);
    expect(memberView.cashCollectedCents).toBe(0);
  });

  it('القائد كمان بياخد حصّته هو مش الوعاء — نفس اللي هينزل محفظته وقت التسوية', async () => {
    const participants: CrewParticipant[] = [
      { technicianId: LEADER, participantRole: 'leader', technicianLevel: 'team_leader', shareWeight: 1.6 },
      { technicianId: MEMBER, participantRole: 'team_member', technicianLevel: 'new', shareWeight: 1 },
    ];
    const leaderView = await service(participants).getTechnicianMoneyView(order({ bookingMode: BookingMode.TEAM }));
    expect(leaderView.isCrewShare).toBe(true);
    expect(leaderView.myEarningCents).toBeLessThan(80000);

    const memberView = await service(participants).getTechnicianMoneyView(
      order({ bookingMode: BookingMode.TEAM }),
      undefined,
      MEMBER,
    );
    // الثابت الحاكم لـADR-0040: مجموع الحصص = الوعاء بالظبط، مفيش قرش ضايع ولا مضاعف.
    expect(leaderView.myEarningCents + memberView.myEarningCents).toBe(80000);
  });

  it('إيداع أونلاين + باقي كاش: بعد تحصيل الكاش يظل الطلب مختلطًا ولا يتحول إلى "أونلاين بالكامل"', async () => {
    const view = await service([], {
      totalAmountCents: 100000,
      onlinePaidAmountCents: 15000,
      amountDueToTechnicianCents: 0,
    }).getTechnicianMoneyView(order());

    expect(view.hasOnlinePayment).toBe(true);
    expect(view.fullyPaidOnline).toBe(false);
    expect(view.cashToCollectCents).toBe(0);
    expect(view.cashCollectedCents).toBe(0);
  });

  it('طلب مدفوع إلكترونيًا بالكامل وحده يحمل علامة "أونلاين بالكامل"', async () => {
    const view = await service([], {
      totalAmountCents: 100000,
      onlinePaidAmountCents: 100000,
      amountDueToTechnicianCents: 0,
    }).getTechnicianMoneyView(order());

    expect(view.hasOnlinePayment).toBe(true);
    expect(view.fullyPaidOnline).toBe(true);
  });
});
