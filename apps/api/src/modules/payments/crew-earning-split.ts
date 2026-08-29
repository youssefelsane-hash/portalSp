/**
 * توزيع مستحقات الشغلانة على الطاقم بوزن المستوى (ADR-0040، docs/08 §63.أ3).
 *
 * دالة **رياضيات صافية** — صفر I/O، صفر تبعيات. كل قرار مالي هنا قابل للاختبار لوحده، وده مقصود:
 * ده الكود اللي بيحدد فلوس ناس حقيقية.
 *
 * الوعاء المُوزَّع هو `technicianEarningCents` (نصيب العمّال **بعد** عمولة المنصة — ADR-0037/0038)،
 * مش إجمالي الطلب. العمولة بتتحسب مرة واحدة على مستوى الطلب وما بتتلمسش هنا.
 */

export interface CrewParticipant {
  technicianId: string;
  participantRole: 'leader' | 'team_member' | 'assistant';
  technicianLevel: string;
  /** وزن المستوى من `technician_level_config.crew_share_weight`. */
  shareWeight: number;
  /** أجر المساعد الأساسي عن كامل مدة الطلب، قبل معامل المستوى. */
  assistantBaseWageCents?: number | null;
  /** معامل المستوى الخاص بالمساعد فقط. */
  assistantLevelMultiplier?: number | null;
  /** المستهدف المحسوب = الأجر الأساسي × معامل المستوى. */
  assistantTargetCents?: number | null;
}

export interface CrewShare extends CrewParticipant {
  shareCents: number;
  calculationMethod: 'weighted_pool' | 'assistant_level_wage';
}

/**
 * بيقسم `poolCents` على المشاركين بالتناسب مع أوزانهم.
 *
 * **ضمانة صارمة**: `Σ shareCents === poolCents` بالظبط دايمًا. فروق التقريب (قروش) بتروح للقائد،
 * فمفيش قرش بيضيع ولا بيتخلق. لو مفيش قائد في القايمة (حالة مش متوقعة)، الفرق بيروح لأول مشارك.
 *
 * حالات حدّية بترجّع نتيجة صحيحة مش استثناء — التسوية مينفعش تفشل بسبب بيانات ناقصة:
 * - مفيش مشاركين → `[]` (الكولر بيتعامل مع ده كـ"مفيش توزيع").
 * - `poolCents <= 0` → كل الحصص صفر (طلب مجاني/ملغي).
 * - مجموع الأوزان <= 0 → قسمة بالتساوي (حماية من إعداد أدمن غلط).
 */
export function splitCrewEarnings(poolCents: number, participants: CrewParticipant[]): CrewShare[] {
  if (participants.length === 0) return [];
  const pool = Math.max(0, Math.trunc(poolCents));
  if (pool === 0) {
    return participants.map((p) => ({ ...p, shareCents: 0, calculationMethod: 'weighted_pool' }));
  }

  const assistants = participants.filter((p) => p.participantRole === 'assistant');
  const assistantsHaveTargets =
    assistants.length > 0 && assistants.every((p) => Number(p.assistantTargetCents ?? 0) > 0);
  const assistantsTargetTotal = assistants.reduce(
    (sum, p) => sum + Math.max(0, Math.trunc(p.assistantTargetCents ?? 0)),
    0,
  );

  // الأجر المحدد للخدمة يخص المساعد فقط. الفنيون يقسمون **المتبقي** بنفس أوزانهم القديمة.
  // لو الإعداد أكبر من الوعاء نرجع للتوزيع النسبي الآمن بدل ما نصفر حصة الفني أو نخلق فلوس.
  if (assistantsHaveTargets && assistantsTargetTotal < pool) {
    const assistantIds = new Set(assistants.map((p) => p.technicianId));
    const fixedShares: CrewShare[] = assistants.map((p) => ({
      ...p,
      shareCents: Math.trunc(p.assistantTargetCents ?? 0),
      calculationMethod: 'assistant_level_wage',
    }));
    const workerShares = splitByWeight(
      pool - assistantsTargetTotal,
      participants.filter((p) => !assistantIds.has(p.technicianId)),
    );
    const byId = new Map([...fixedShares, ...workerShares].map((share) => [share.technicianId, share]));
    return participants.map((participant) => byId.get(participant.technicianId)!);
  }

  return splitByWeight(pool, participants);
}

function splitByWeight(pool: number, participants: CrewParticipant[]): CrewShare[] {
  if (participants.length === 0) return [];

  const totalWeight = participants.reduce((sum, p) => sum + (p.shareWeight > 0 ? p.shareWeight : 0), 0);
  // إعداد أوزان غلط تمامًا (كلها صفر/سالبة) — بنقسم بالتساوي بدل ما نرمي أو نقسم على صفر.
  const weights = totalWeight > 0 ? participants.map((p) => (p.shareWeight > 0 ? p.shareWeight : 0)) : participants.map(() => 1);
  const weightSum = totalWeight > 0 ? totalWeight : participants.length;

  const shares: CrewShare[] = participants.map((p, i) => ({
    ...p,
    shareCents: Math.floor((pool * weights[i]) / weightSum),
    calculationMethod: 'weighted_pool',
  }));

  // باقي القسمة بيروح للقائد — عشان المجموع يساوي الوعاء بالظبط.
  const distributed = shares.reduce((sum, s) => sum + s.shareCents, 0);
  const remainder = pool - distributed;
  if (remainder !== 0) {
    const leaderIndex = shares.findIndex((s) => s.participantRole === 'leader');
    shares[leaderIndex >= 0 ? leaderIndex : 0].shareCents += remainder;
  }
  return shares;
}
