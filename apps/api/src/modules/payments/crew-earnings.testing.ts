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
    listForOrder: async () => [],
  } as unknown as CrewEarningsService;
}
