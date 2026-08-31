import { EntityManager } from 'typeorm';

export interface PricingTimelineEntry {
  validFrom: Date;
  validUntil: Date | null;
}

export interface PricingTimelineNeighbors<T extends PricingTimelineEntry> {
  exact: T | null;
  predecessor: T | null;
  successor: T | null;
}

/** Serialises changes to one commercial price timeline without blocking other services. */
export async function lockPricingTimeline(manager: EntityManager, key: string): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

export function findPricingTimelineNeighbors<T extends PricingTimelineEntry>(
  entries: T[],
  target: Date,
): PricingTimelineNeighbors<T> {
  const targetMs = target.getTime();
  const sorted = [...entries].sort((left, right) => left.validFrom.getTime() - right.validFrom.getTime());
  return {
    exact: sorted.find((entry) => entry.validFrom.getTime() === targetMs) ?? null,
    predecessor: [...sorted].reverse().find((entry) => entry.validFrom.getTime() < targetMs) ?? null,
    successor: sorted.find((entry) => entry.validFrom.getTime() > targetMs) ?? null,
  };
}

/** Connects adjacent half-open intervals around target and returns the new row's end. */
export function connectPricingTimeline<T extends PricingTimelineEntry>(
  neighbors: PricingTimelineNeighbors<T>,
  target: Date,
): Date | null {
  if (neighbors.predecessor) neighbors.predecessor.validUntil = target;
  const validUntil = neighbors.successor?.validFrom ?? null;
  if (neighbors.exact) neighbors.exact.validUntil = validUntil;
  return validUntil;
}
