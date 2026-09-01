import { TechnicianMonthlyStatement } from './technician-earnings.service';
import { toTechnicianStatementResponse } from './technician-payments.controller';

describe('toTechnicianStatementResponse', () => {
  it('returns worker-owned money only and never leaks order or platform economics', () => {
    const full = {
      month: '2026-08',
      monthStart: '2026-08-01',
      monthEnd: '2026-08-31',
      isCurrentMonth: true,
      jobsCount: 1,
      totals: {
        originalPriceCents: 100_000,
        additionalWorkCents: 10_000,
        levelPremiumCents: 5_000,
        customerDiscountCents: 2_000,
        customerPaidCents: 98_000,
        platformCommissionCents: 15_000,
        discountBorneByTechnicianCents: 0,
        refundReversalCents: 2_000,
        grossTechnicianEarningCents: 50_000,
        cashCollectedCents: 20_000,
        netTechnicianDueCents: 28_000,
      },
      jobs: [
        {
          orderId: 'order-id',
          orderNumber: 'ORD-1',
          serviceNameAr: 'خدمة',
          closedAt: '2026-08-31T12:00:00.000Z',
          originalPriceCents: 100_000,
          additionalWorkCents: 10_000,
          levelPremiumCents: 5_000,
          participantRole: 'assistant',
          refundReversalCents: 2_000,
          grossTechnicianEarningCents: 50_000,
          cashCollectedCents: 20_000,
          customerDiscountCents: 2_000,
          customerPaidCents: 98_000,
          commissionableBaseCents: 90_000,
          commissionRatePercentage: 15,
          platformCommissionCents: 15_000,
          discountBorneByTechnicianCents: 0,
          netTechnicianDueCents: 28_000,
        },
      ],
    } satisfies TechnicianMonthlyStatement;

    const response = toTechnicianStatementResponse(full);
    const serialized = JSON.stringify(response);

    expect(response.jobs[0]).toEqual({
      orderId: 'order-id',
      orderNumber: 'ORD-1',
      serviceNameAr: 'خدمة',
      closedAt: '2026-08-31T12:00:00.000Z',
      participantRole: 'assistant',
      refundReversalCents: 2_000,
      grossTechnicianEarningCents: 50_000,
      cashCollectedCents: 20_000,
      netTechnicianDueCents: 28_000,
    });
    for (const forbidden of [
      'originalPriceCents',
      'customerPaidCents',
      'customerDiscountCents',
      'commissionableBaseCents',
      'commissionRatePercentage',
      'platformCommissionCents',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
