import { AdminWarrantyPlansController } from './admin-warranty-plans.controller';

describe('AdminWarrantyPlansController response contract', () => {
  it('returns snake_case fields consumed by the admin service-link UI', async () => {
    const createdAt = new Date('2026-08-25T00:00:00.000Z');
    const controller = new AdminWarrantyPlansController(
      {
        find: jest.fn().mockResolvedValue([{
          id: 'plan-1',
          slug: 'extended-1y',
          nameAr: 'ضمان سنة',
          warrantyType: 'extended_workmanship',
          targetServiceId: 'service-1',
          targetCategoryId: null,
          targetProjectType: null,
          pricingModel: 'percentage',
          priceValue: '30.00',
          coverageMonths: 12,
          maxCoverageCents: null,
          maxClaims: 2,
          termsAr: 'الشروط',
          exclusionsAr: null,
          liabilityBearer: 'provider',
          isActive: true,
          version: 1,
          createdAt,
          updatedAt: createdAt,
        }]),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(controller.list()).resolves.toEqual([
      expect.objectContaining({
        name_ar: 'ضمان سنة',
        target_service_id: 'service-1',
        pricing_model: 'percentage',
        price_value: '30.00',
        coverage_months: 12,
        is_active: true,
      }),
    ]);
  });
});
