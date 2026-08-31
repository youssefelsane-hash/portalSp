import { connectPricingTimeline, findPricingTimelineNeighbors } from './pricing-timeline';

function entry(from: string, until: string | null = null) {
  return { validFrom: new Date(from), validUntil: until ? new Date(until) : null };
}

describe('pricing timeline', () => {
  it('inserts a version between predecessor and successor without overlap', () => {
    const first = entry('2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z');
    const successor = entry('2026-09-20T00:00:00Z');
    const target = new Date('2026-09-10T00:00:00Z');

    const validUntil = connectPricingTimeline(findPricingTimelineNeighbors([successor, first], target), target);

    expect(first.validUntil).toEqual(target);
    expect(validUntil).toEqual(successor.validFrom);
  });

  it('updates an exact future version instead of creating a duplicate start', () => {
    const first = entry('2026-09-01T00:00:00Z');
    const exact = entry('2026-09-10T00:00:00Z');
    const successor = entry('2026-09-20T00:00:00Z');
    const target = new Date('2026-09-10T00:00:00Z');
    const neighbors = findPricingTimelineNeighbors([first, exact, successor], target);

    const validUntil = connectPricingTimeline(neighbors, target);

    expect(neighbors.exact).toBe(exact);
    expect(first.validUntil).toEqual(target);
    expect(exact.validUntil).toEqual(successor.validFrom);
    expect(validUntil).toEqual(successor.validFrom);
  });
});
