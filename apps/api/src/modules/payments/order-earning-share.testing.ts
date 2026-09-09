import { EARNINGS_V2_ALGORITHM_VERSION } from './earnings-calculator';

/**
 * إدخال صف حصة مستحقات **مكتمل** في الاختبارات — بديل واحد لكل الفكسچرز اليدوية.
 *
 * ## المشكلة اللي الملف ده موجود عشانها
 *
 * `settlement_policy_version` في `order_earning_shares` افتراضيه **2**، و
 * `chk_order_earning_shares_v2_complete_snapshot` بيفرض على أي صف v2 إحدى عشر عمود snapshot
 * مليانين (`calculation_method='earnings_policy_v2'` + نسخة الخوارزمية + نوع الفني + الدور +
 * أوزان المستوى/المساعد/المهارة + التعديلات + الوزن الفعّال). الفكسچرز القديمة اتكتبت **قبل**
 * القيد ده وبتدخّل الأعمدة السبعة الأصلية بس، فبقت بترمي على مستوى القاعدة من غير ما تقيس
 * حاجة — الاختبار بيفشل في سطر الإدخال قبل ما يوصل للسلوك اللي هو موضوعه أصلاً.
 *
 * تكرار الإحدى عشر عمود في كل spec كان هيخلّي أي قيد جديد يكسر الفكسچرز تاني. المكان الواحد ده
 * بيخلّي التصحيح الجاي في سطر واحد، وبيضمن إن الفكسچر بيكتب **نفس اللي**
 * `CrewEarningsService.recordV2Shares()` بيكتبه في الإنتاج مش شكل مبسّط بيكذب.
 */
export interface V2EarningShareFixture {
  orderId: string;
  technicianId: string;
  participantRole: 'leader' | 'team_member' | 'assistant';
  poolCents: number;
  shareCents: number;
  /** مستوى الفني وقت التسوية (snapshot) — الافتراضي `new` زي أغلب فكسچرز الاختبار. */
  technicianLevel?: 'new' | 'verified' | 'professional' | 'premium' | 'team_leader';
  /** الدور المحاسبي: فني كامل ولا مساعد. الافتراضي مشتق من `participantRole`. */
  earningRole?: 'technician' | 'assistant';
  levelWeightBps?: number;
  serviceSkill?: 'beginner' | 'standard' | 'expert';
}

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown>;

/** الأعمدة والقيم بترتيب واحد — مفيش تكرار بين الـSQL والـparams. */
export async function insertV2EarningShare(q: QueryFn, fixture: V2EarningShareFixture): Promise<void> {
  const earningRole = fixture.earningRole ?? (fixture.participantRole === 'assistant' ? 'assistant' : 'technician');
  const levelWeightBps = fixture.levelWeightBps ?? 10_000;

  await q(
    `INSERT INTO order_earning_shares (
       order_id, technician_id, participant_role, technician_level, share_weight, pool_cents, share_cents,
       calculation_method, settlement_policy_version, calculation_algorithm_version,
       technician_kind_snapshot, earning_role, level_weight_bps_snapshot, assistant_ratio_bps_snapshot,
       service_skill_snapshot, service_skill_factor_bps_snapshot,
       individual_adjustment_bps_snapshot, order_adjustment_bps_snapshot, effective_weight_units
     ) VALUES ($1,$2,$3,$4::technician_level,$5,$6,$7,'earnings_policy_v2',2,$8,$9,$10,$11,10000,$12::skill_level,10000,0,0,$13)`,
    [
      fixture.orderId,
      fixture.technicianId,
      fixture.participantRole,
      fixture.technicianLevel ?? 'new',
      (levelWeightBps / 10_000).toFixed(2),
      fixture.poolCents,
      fixture.shareCents,
      EARNINGS_V2_ALGORITHM_VERSION,
      earningRole,
      earningRole,
      levelWeightBps,
      fixture.serviceSkill ?? 'standard',
      String(levelWeightBps),
    ],
  );
}
