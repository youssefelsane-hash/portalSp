import { CrewEarningsService } from './crew-earnings.service';
import { EARNINGS_V2_ALGORITHM_VERSION } from './earnings-calculator';

/** الحد الأدنى اللي مستهلكي `listForOrder()` بيقروه فعلاً من صف الحصة. */
interface StubShareRow {
  orderId: string;
  technicianId: string;
  participantRole: 'leader' | 'team_member' | 'assistant';
  technicianLevel: string;
  shareWeight: number;
  poolCents: number;
  shareCents: number;
  calculationMethod: string;
  settlementPolicyVersion: number;
  calculationAlgorithmVersion: string | null;
  assistantBaseWageCents: number | null;
  assistantLevelMultiplier: number | null;
  assistantTargetCents: number | null;
}

/**
 * بديل خفيف لـ`CrewEarningsService` في الاختبارات اللي بتركّب `PaymentsService` بإيدها.
 *
 * بيرجّع **حصة واحدة للقائد بكل الوعاء** — يعني نفس سلوك ما قبل ADR-0040 بالظبط، فالاختبارات
 * القديمة (اللي بتتحقق من حركة محفظة واحدة) تفضل صالحة من غير ما تتعدّل. الاختبارات اللي
 * موضوعها التوزيع نفسه بتستخدم الخدمة الحقيقية على Postgres حقيقي.
 *
 * ## ليه البديل **بيفتكر** اللي سجّله (مش بيرجّع `[]` من `listForOrder`)
 *
 * النسخة القديمة كانت بترجّع حصص من `recordShares`/`recordV2Shares` وترجّع `[]` من
 * `listForOrder` — يعني بديل **بيناقض نفسه**: بيدّعي إنه وزّع، وبعدين يقول مفيش توزيع. بعد
 * ADR-0288 بقى `refundOrder()` بيسأل `listForOrder()` عشان يتأكد إن التوزيع مكتمل قبل ما
 * يبعت للبوابة (`assertV2SettlementSnapshotRefundable`)، فالتناقض ده كان بيقلب كل اختبار
 * استرداد لـ«توزيع مستحقات الطلب غير مكتمل» — خطأ في البديل، مش في الكود المختبَر.
 *
 * الحالة محلية لكل نسخة بديل، فكل سويتة بتبدأ فاضية ومفيش تسريب بين الاختبارات.
 */
export function crewEarningsServiceStub(): CrewEarningsService {
  const recorded = new Map<string, StubShareRow[]>();

  const remember = (orderId: string, rows: StubShareRow[]): StubShareRow[] => {
    const existing = recorded.get(orderId);
    if (existing && existing.length > 0) return existing;
    recorded.set(orderId, rows);
    return rows;
  };

  return {
    resolveParticipants: async () => [],

    recordShares: async (_manager: unknown, order: { id: string; technicianId: string | null }, poolCents: number) => {
      if (!order.technicianId) return [];
      const rows = remember(order.id, [
        {
          orderId: order.id,
          technicianId: order.technicianId,
          participantRole: 'leader',
          technicianLevel: 'professional',
          shareWeight: 1,
          poolCents,
          shareCents: poolCents,
          calculationMethod: 'weighted_pool',
          settlementPolicyVersion: 1,
          calculationAlgorithmVersion: null,
          assistantBaseWageCents: null,
          assistantLevelMultiplier: null,
          assistantTargetCents: null,
        },
      ]);
      return rows.map((row) => ({
        technicianId: row.technicianId,
        participantRole: row.participantRole,
        technicianLevel: row.technicianLevel,
        shareWeight: row.shareWeight,
        shareCents: row.shareCents,
      }));
    },

    // V2 بقى هو الافتراضي للطلبات الجديدة. البديل الخفيف لازم يعكس الحصص التي حسبها المحرك
    // فعلًا، وإلا اختبارات التسوية اليدوية تختبر V1 بالخطأ أو تنهار قبل الوصول لدفتر القيود.
    recordV2Shares: async (
      _manager: unknown,
      order: { id: string },
      calculation: {
        workerPoolCents: number;
        participantShares: Array<{
          technicianId: string;
          earningRole: 'technician' | 'assistant';
          isLeader: boolean;
          technicianLevel: string;
          levelWeightBps: number;
          shareCents: number;
        }>;
      },
    ) => {
      const rows = remember(
        order.id,
        calculation.participantShares.map((share) => ({
          orderId: order.id,
          technicianId: share.technicianId,
          participantRole: share.isLeader
            ? ('leader' as const)
            : share.earningRole === 'assistant'
              ? ('assistant' as const)
              : ('team_member' as const),
          technicianLevel: share.technicianLevel,
          shareWeight: share.levelWeightBps / 10_000,
          poolCents: calculation.workerPoolCents,
          shareCents: share.shareCents,
          calculationMethod: 'earnings_policy_v2',
          settlementPolicyVersion: 2,
          calculationAlgorithmVersion: EARNINGS_V2_ALGORITHM_VERSION,
          assistantBaseWageCents: null,
          assistantLevelMultiplier: null,
          assistantTargetCents: null,
        })),
      );
      return rows.map((row) => ({
        technicianId: row.technicianId,
        participantRole: row.participantRole,
        technicianLevel: row.technicianLevel,
        shareWeight: row.shareWeight,
        shareCents: row.shareCents,
        calculationMethod: row.calculationMethod,
      }));
    },

    // **القاعدة الأول، والذاكرة بديل**: في اختبارات بتدخّل صفوف الحصص بإيدها (طلب مقفول
    // متسجّل مباشرةً) الحصة عايشة في `order_earning_shares` مش في الذاكرة. البديل بيقرا من
    // نفس الـmanager اللي الكود الحقيقي بيمرّره، وبيرجع للذاكرة بس لو القاعدة فاضية —
    // يعني التسوية اللي مشيت عبر البديل (اللي مابتكتبش صفوف) تفضل مرئية.
    listForOrder: async (manager: { query?: (sql: string, params?: unknown[]) => Promise<unknown> }, orderId: string) => {
      if (typeof manager?.query === 'function') {
        const rows = (await manager.query(
          `SELECT order_id AS "orderId", technician_id AS "technicianId", participant_role AS "participantRole",
                  technician_level AS "technicianLevel", share_weight AS "shareWeight", pool_cents AS "poolCents",
                  share_cents AS "shareCents", calculation_method AS "calculationMethod",
                  settlement_policy_version AS "settlementPolicyVersion",
                  calculation_algorithm_version AS "calculationAlgorithmVersion",
                  assistant_base_wage_cents AS "assistantBaseWageCents",
                  assistant_level_multiplier AS "assistantLevelMultiplier",
                  assistant_target_cents AS "assistantTargetCents"
             FROM order_earning_shares
            WHERE order_id = $1 AND deleted_at IS NULL
            ORDER BY share_cents DESC`,
          [orderId],
        )) as Array<Record<string, unknown>>;
        if (rows.length > 0) {
          return rows.map((row) => ({ ...row, shareCents: Number(row.shareCents), poolCents: Number(row.poolCents) }));
        }
      }
      return [...(recorded.get(orderId) ?? [])].sort((a, b) => b.shareCents - a.shareCents);
    },
  } as unknown as CrewEarningsService;
}
