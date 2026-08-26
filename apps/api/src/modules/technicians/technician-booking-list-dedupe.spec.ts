import {
  dedupeTechnicianBookingItems,
  TechnicianBookingListItem,
} from './technicians.service';

function item(technicianId: string, availabilityStatus: 'available' | 'schedule_conflicted') {
  return {
    technicianId,
    fullName: technicianId,
    avatarUrl: null,
    avatarStorageKey: null,
    bio: null,
    averageRating: 5,
    totalRatingsCount: 1,
    serviceCompletedCount: 1,
    distanceKm: 1,
    currentLevel: 'verified',
    pricingTier: 'standard',
    isVerified: true,
    onTimeRatePercent: null,
    avgArrivalMinutes: null,
    isCompany: false,
    staffCount: null,
    branchCount: null,
    companyId: null,
    companyName: null,
    isCommercialCompany: false,
    availabilityStatus,
    unavailableReasonAr: null,
    availableAgainAt: null,
  } as TechnicianBookingListItem;
}

describe('dedupeTechnicianBookingItems', () => {
  it('keeps one stable row per technician when eligibility buckets overlap', () => {
    const result = dedupeTechnicianBookingItems([
      item('technician-a', 'available'),
      item('technician-b', 'available'),
      item('technician-a', 'schedule_conflicted'),
    ]);

    expect(result.map((candidate) => candidate.technicianId)).toEqual([
      'technician-a',
      'technician-b',
    ]);
    expect(result[0].availabilityStatus).toBe('available');
  });
});
