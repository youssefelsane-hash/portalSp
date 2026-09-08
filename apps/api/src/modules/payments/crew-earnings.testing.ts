import { CrewEarningsService } from './crew-earnings.service';

/**
 * بديل خفيف لـ`CrewEarningsService` في الاختبارات اللي بتركّب `PaymentsService` بإيدها.
 *
 * بيرجّع **حصة واحدة للقائد بكل الوعاء** — يعني نفس سلوك ما قبل ADR-0040 بالظبط، فالاختبارات
 * القديمة (اللي بتتحقق من حركة محفظة واحدة) تفضل صالحة من غير ما تتعدّل. الاختبارات اللي
 * موضوعها التوزيع نفسه بتستخدم الخدمة الحقيقية على Postgres حقيقي.
 */
export function crewEarningsServiceStub(): CrewEarningsService {
  return {
    resolveParticipants: async () => [],
    recordShares: async (_manager: unknown, order: { technicianId: string | null }, poolCents: number) =>
      order.technicianId
        ? [
            {
              technicianId: order.technicianId,
              participantRole: 'leader' as const,
              technicianLevel: 'professional',
              shareWeight: 1,
              shareCents: poolCents,
            },
          ]
        : [],
    // V2 بقى هو الافتراضي للطلبات الجديدة. البديل الخفيف لازم يعكس الحصص التي حسبها المحرك
    // فعلًا، وإلا اختبارات التسوية اليدوية تختبر V1 بالخطأ أو تنهار قبل الوصول لدفتر القيود.
    recordV2Shares: async (
      _manager: unknown,
      _order: unknown,
      calculation: {
        participantShares: Array<{
          technicianId: string;
          earningRole: 'technician' | 'assistant';
          isLeader: boolean;
          technicianLevel: string;
          levelWeightBps: number;
          shareCents: number;
        }>;
      },
    ) =>
      calculation.participantShares.map((share) => ({
        technicianId: share.technicianId,
        participantRole: share.isLeader ? ('leader' as const) : share.earningRole === 'assistant' ? ('assistant' as const) : ('team_member' as const),
        technicianLevel: share.technicianLevel,
        shareWeight: share.levelWeightBps / 10_000,
        shareCents: share.shareCents,
        calculationMethod: 'earnings_policy_v2',
      })),
    listForOrder: async () => [],
  } as unknown as CrewEarningsService;
}
