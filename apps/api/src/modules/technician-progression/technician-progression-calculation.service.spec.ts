import { DataSource } from 'typeorm';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { TechnicianProgressionCalculationService, ProgressionRawMetrics } from './technician-progression-calculation.service';
import { TechnicianProgressionRule } from './entities/technician-progression-rule.entity';

const rule = (fromLevel: TechnicianLevel, toLevel: TechnicianLevel): TechnicianProgressionRule =>
  ({
    fromLevel,
    toLevel,
    enabled: true,
    autoPromote: false,
    minCompletedOrders: 10,
    minPlatformRevenueCents: '100000',
    minAvgRating: '4.00',
    maxCancellationRate: '10.00',
    maxUpheldComplaints: 0,
    minAvgKpiScore: '75.00',
    minKpiMonthsCount: 2,
    minDaysActive: 30,
    enableDemotionReview: false,
    demotionReviewMaxCancellationRate: null,
    demotionReviewMinAvgRating: null,
    demotionReviewMaxUpheldComplaints: null,
  }) as TechnicianProgressionRule;

describe('TechnicianProgressionCalculationService workforce parity', () => {
  it('lets a permanent assistant progress through the same five-level career ladder', () => {
    const service = new TechnicianProgressionCalculationService({} as DataSource);
    const assistantMetrics: ProgressionRawMetrics = {
      completedOrdersCount: 100,
      acceptedOrdersCount: 105,
      technicianCancelledCount: 1,
      cancellationRate: 0.95,
      averageRating: 4.9,
      ratingsCount: 90,
      platformRevenueCents: 5_000_000,
      upheldComplaintsCount: 0,
      daysActive: 500,
      avgKpiScore: 95,
      kpiMonthsAvailable: 12,
    };
    const ladder: Array<[TechnicianLevel, TechnicianLevel]> = [
      [TechnicianLevel.NEW, TechnicianLevel.VERIFIED],
      [TechnicianLevel.VERIFIED, TechnicianLevel.PROFESSIONAL],
      [TechnicianLevel.PROFESSIONAL, TechnicianLevel.PREMIUM],
      [TechnicianLevel.PREMIUM, TechnicianLevel.TEAM_LEADER],
    ];

    for (const [fromLevel, toLevel] of ladder) {
      const evaluation = service.evaluate(assistantMetrics, rule(fromLevel, toLevel));
      expect(evaluation.isEligible).toBe(true);
      expect(evaluation.unmetRequirements).toEqual([]);
    }
  });
});
