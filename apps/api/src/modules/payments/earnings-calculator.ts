/**
 * Earnings Policy V2 pure calculator.
 *
 * Money is always integer piasters and policy factors are integer basis points. The function
 * performs no I/O so previews, settlement, refunds, and audit tools can share one exact result.
 */

export const EARNINGS_V2_ALGORITHM_VERSION = 'earnings-v2-largest-remainder-1';

export type EarningRole = 'technician' | 'assistant';

export interface EarningsParticipantInput {
  technicianId: string;
  earningRole: EarningRole;
  isLeader: boolean;
  technicianKindSnapshot: EarningRole;
  technicianLevel: string;
  levelWeightBps: number;
  assistantRatioBps: number;
  serviceWageTier: string;
  serviceWageFactorBps: number;
  individualAdjustmentBps?: number;
  orderAdjustmentBps?: number;
}

export interface EarningsShareResult extends EarningsParticipantInput {
  shareCents: number;
  effectiveWeightUnits: string;
  calculationMethod: 'earnings_policy_v2';
}

export interface EarningsCalculationResult {
  settlementPolicyVersion: 2;
  calculationAlgorithmVersion: typeof EARNINGS_V2_ALGORITHM_VERSION;
  orderTotalCents: number;
  platformCommissionCents: number;
  workerPoolCents: number;
  participantShares: EarningsShareResult[];
}

export function calculateEarningsV2(
  orderTotalCents: number,
  platformCommissionCents: number,
  participants: EarningsParticipantInput[],
): EarningsCalculationResult {
  assertMoney('orderTotalCents', orderTotalCents);
  assertSignedMoney('platformCommissionCents', platformCommissionCents);
  if (platformCommissionCents > orderTotalCents) {
    throw new Error('V2 platform commission cannot exceed the final order total');
  }

  validateParticipants(participants);
  const workerPoolCents = orderTotalCents - platformCommissionCents;
  if (workerPoolCents > 0 && participants.length === 0) {
    throw new Error('V2 paid worker pool requires at least one participant');
  }

  const weighted = participants.map((participant, inputIndex) => ({
    participant,
    inputIndex,
    weight: effectiveWeight(participant),
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0n);
  if (participants.length > 0 && totalWeight <= 0n) {
    throw new Error('V2 participant effective weight must be positive');
  }

  const pool = BigInt(workerPoolCents);
  const allocated = weighted.map((item) => {
    const weightedPool = pool * item.weight;
    return {
      ...item,
      share: totalWeight === 0n ? 0n : weightedPool / totalWeight,
      fraction: totalWeight === 0n ? 0n : weightedPool % totalWeight,
    };
  });

  const floorTotal = allocated.reduce((sum, item) => sum + item.share, 0n);
  const remainderCents = Number(pool - floorTotal);
  const remainderOrder = [...allocated].sort((left, right) => {
    if (left.fraction !== right.fraction) return left.fraction > right.fraction ? -1 : 1;
    return left.participant.technicianId.localeCompare(right.participant.technicianId);
  });
  for (let index = 0; index < remainderCents; index += 1) {
    remainderOrder[index].share += 1n;
  }

  const participantShares = allocated
    .sort((left, right) => left.inputIndex - right.inputIndex)
    .map(({ participant, share, weight }) => ({
      ...participant,
      individualAdjustmentBps: participant.individualAdjustmentBps ?? 0,
      orderAdjustmentBps: participant.orderAdjustmentBps ?? 0,
      shareCents: Number(share),
      effectiveWeightUnits: weight.toString(),
      calculationMethod: 'earnings_policy_v2' as const,
    }));

  const distributed = participantShares.reduce((sum, share) => sum + share.shareCents, 0);
  if (distributed !== workerPoolCents) {
    throw new Error('V2 invariant failed: participant shares do not equal the worker pool');
  }

  return {
    settlementPolicyVersion: 2,
    calculationAlgorithmVersion: EARNINGS_V2_ALGORITHM_VERSION,
    orderTotalCents,
    platformCommissionCents,
    workerPoolCents,
    participantShares,
  };
}

function effectiveWeight(participant: EarningsParticipantInput): bigint {
  const individualFactor = 10_000 + (participant.individualAdjustmentBps ?? 0);
  const orderFactor = 10_000 + (participant.orderAdjustmentBps ?? 0);
  const roleFactor = participant.earningRole === 'assistant' ? participant.assistantRatioBps : 10_000;

  assertFactor('levelWeightBps', participant.levelWeightBps);
  assertFactor('assistantRatioBps', participant.assistantRatioBps);
  assertFactor('serviceWageFactorBps', participant.serviceWageFactorBps);
  assertFactor('individual adjustment factor', individualFactor);
  assertFactor('order adjustment factor', orderFactor);

  return (
    BigInt(participant.levelWeightBps) *
    BigInt(roleFactor) *
    BigInt(participant.serviceWageFactorBps) *
    BigInt(individualFactor) *
    BigInt(orderFactor)
  );
}

function validateParticipants(participants: EarningsParticipantInput[]): void {
  const ids = new Set<string>();
  let leaders = 0;
  for (const participant of participants) {
    if (!participant.technicianId) throw new Error('V2 participant requires technicianId');
    if (ids.has(participant.technicianId)) throw new Error(`Duplicate V2 participant: ${participant.technicianId}`);
    ids.add(participant.technicianId);

    if (participant.isLeader) leaders += 1;
    // مقيّد بغير القائد عمدًا: الحارس ده بيمسك **بيانات مخالفة** — صف مساعد مسجّل
    // `team_member` جوّه طاقم حد تاني، اللي كان هيديله تسعيرة فني بالغلط. بيفضل زي ما هو.
    if (
      !participant.isLeader &&
      participant.technicianKindSnapshot === 'assistant' &&
      participant.earningRole !== 'assistant'
    ) {
      throw new Error('A permanent assistant joining another crew must use the assistant earning role');
    }
    // **اتشال حارس «المساعد مايقودش» هنا** (قرار مالك 2026-09-20، ADR-0108).
    //
    // كان: `isLeader && earningRole === 'assistant'` ⇒ رمي. الحارس ده كان مبني على السياسة
    // القديمة (ADR-0055 §3) اللي بتقول إن المساعد لما يقود بياخد تسعيرة فني كاملة، فالتركيبة
    // دي كانت معناها بيانات متناقضة. القاعدة الجديدة بتخلّيها **الحالة الطبيعية**: المساعد
    // بياخد معامل رتبته كمساعد حتى وهو قائد الطاقم.
    //
    // شيله مش اختياري مع تغيير `EarningsPolicyService.resolveParticipants()` — الاتنين لازم
    // يتحركوا مع بعض. لو الـresolver اتغيّر والحارس فضل، كل تسوية لطلب قائده مساعد كانت هترمي
    // والطلب يتعلّق على `work_completed/unpaid` للأبد (لا العميل يدفع، ولا حد ياخد نصيبه، ولا
    // المنصة تاخد عمولتها) — وده بالظبط اللي حصل فعليًا في 2026-09-11 قبل ما يتلقط.
    //
    // «طاقم فيه قائد واحد بالظبط» لسه مفروضة تحت — دي عن **عدد** القادة مش عن نوعهم.
  }
  if (participants.length > 0 && leaders !== 1) {
    throw new Error('V2 earning crew must contain exactly one leader');
  }
}

function assertMoney(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer in piasters`);
  }
}

/**
 * A platform-funded discount can make the platform share negative while the technician keeps
 * their full pre-discount earning. The value is still exact integer money; only its direction
 * differs. Rejecting it here made valid discounted orders disappear from technician reads.
 */
function assertSignedMoney(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer in piasters`);
  }
}

function assertFactor(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer basis-point factor`);
  }
}
