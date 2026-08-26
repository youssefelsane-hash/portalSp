import { TechnicianBookingListItem } from '../technicians/technicians.service';
import { formatEligibleTechniciansForAdmin } from './admin-orders.service';

function candidate(overrides: Partial<TechnicianBookingListItem>): TechnicianBookingListItem {
  return {
    technicianId: 'technician-1',
    fullName: 'فني الشركة',
    avatarUrl: null,
    avatarStorageKey: null,
    bio: null,
    averageRating: 4.8,
    totalRatingsCount: 20,
    serviceCompletedCount: 15,
    distanceKm: 2,
    currentLevel: 'professional' as never,
    pricingTier: 'standard' as never,
    isVerified: true,
    onTimeRatePercent: 95,
    avgArrivalMinutes: 20,
    isCompany: false,
    staffCount: null,
    branchCount: null,
    companyId: 'company-1',
    companyName: 'شركة التنفيذ',
    isCommercialCompany: true,
    availabilityStatus: 'available',
    unavailableReasonAr: null,
    availableAgainAt: null,
    ...overrides,
  };
}

describe('formatEligibleTechniciansForAdmin', () => {
  it('يستبعد company_id غير الصالح كفني ويعرض ممثل الشركة ببروفايله الحقيقي', () => {
    const result = formatEligibleTechniciansForAdmin({
      zoneId: 'zone-1',
      items: [
        candidate({ technicianId: 'company-1', fullName: 'شركة التنفيذ', isCompany: true }),
        candidate({ technicianId: 'profile-1' }),
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      technicianId: 'profile-1',
      fullName: 'فني الشركة — شركة التنفيذ',
      companyId: 'company-1',
    });
  });
});
