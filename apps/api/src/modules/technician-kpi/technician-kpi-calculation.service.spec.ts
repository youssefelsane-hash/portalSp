import { TechnicianKpiCalculationService } from './technician-kpi-calculation.service';

describe('TechnicianKpiCalculationService.getRawMetrics', () => {
  it('يتعامل مع حد تقييم عشري من الإعدادات من غير خطأ smallint', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ completed_orders_count: '1', platform_revenue_cents: '100', order_value_cents: '1000' }])
      .mockResolvedValueOnce([{ offered_orders_count: '2', accepted_orders_count: '1' }])
      .mockResolvedValueOnce([{ technician_cancelled_count: '0' }])
      .mockResolvedValueOnce([
        {
          average_rating: '4.00',
          ratings_count: '2',
          negative_ratings_count: '1',
          average_cleanliness_rating: '4.50',
        },
      ])
      .mockResolvedValueOnce([
        { complaints_count: '0', complaints_upheld_count: '0', serious_upheld_complaint: false },
      ])
      .mockResolvedValueOnce([{ revisit_count: '0' }])
      .mockResolvedValueOnce([{ technician_earnings_cents: '800' }]);
    const settings = { getNumber: jest.fn().mockResolvedValue(3.3) };
    const service = new TechnicianKpiCalculationService({ query } as never, settings as never);

    const result = await service.getRawMetrics('tech-1', 'user-1', 2026, 8);

    const ratingsCall = query.mock.calls[3] as [string, unknown[]];
    expect(ratingsCall[0]).toContain('r.overall_rating::numeric <= $4::numeric');
    expect(ratingsCall[1][3]).toBe(3.3);
    expect(result.negativeRatingsCount).toBe(1);
    expect(result.technicianEarningsCents).toBe(800);
  });
});
