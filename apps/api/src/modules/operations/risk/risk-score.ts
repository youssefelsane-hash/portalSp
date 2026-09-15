/**
 * **حاسبة درجة المخاطر — دوال خالصة بلا أي I/O** (ADR-0085).
 *
 * الملف ده متعمَّد إنه يكون قابل للاختبار بالورقة والقلم: أي قرار بيتعاقب عليه إنسان لازم
 * يكون ممكن إعادة إنتاجه بالإيد. الاستعلامات مكانها `risk-detector.service.ts`، والعرض مكانه
 * الـcontroller.
 */

/** أحكام المراجع على الإشارة — مطابقة لـ`CHECK` بتاع `risk_signals.verdict` بالحرف. */
export type RiskVerdict =
  | 'pending'
  | 'legitimate'
  | 'suspicious'
  | 'confirmed_abuse'
  | 'insufficient_evidence';

export type RiskBucket =
  | 'pricing_abuse'
  | 'parts_manipulation'
  | 'order_abuse'
  | 'off_platform_leakage'
  | 'customer_abuse'
  | 'collusion_fraud';

export type RiskLevel = 'normal' | 'watch' | 'medium' | 'high' | 'critical';

export interface ScorableSignal {
  id: string;
  signalTypeCode: string;
  bucket: RiskBucket;
  labelAr: string;
  /** وزن النوع، أو `weightOverride` لو الإشارة دي أشد من المعتاد. */
  weight: number;
  occurredAt: Date;
  verdict: RiskVerdict;
  /** الأرقام اللي بتفسّر الإشارة — بتتمرّر كما هي للواجهة. */
  evidence: Record<string, unknown>;
  orderId?: string | null;
}

/** سطر واحد في تفسير الدرجة — **مفيش درجة بترجع من غير المصفوفة دي** (ADR-0085 §2). */
export interface RiskScoreLine {
  signalId: string;
  signalTypeCode: string;
  bucket: RiskBucket;
  labelAr: string;
  baseWeight: number;
  ageDays: number;
  decayFactor: number;
  verdict: RiskVerdict;
  verdictFactor: number;
  /** المساهمة الفعلية في الدرجة بعد الاضمحلال وحكم المراجع. */
  contribution: number;
  evidence: Record<string, unknown>;
  orderId?: string | null;
}

export interface RiskScoreResult {
  score: number;
  level: RiskLevel;
  /** مرتّبة تنازليًا بالمساهمة — أهم سبب فوق، عشان المراجع يفهم في ١٠ ثواني. */
  lines: RiskScoreLine[];
  /** مجموع المساهمات لكل bucket — بيدّي «نوع التلاعب الغالب» بلا قراءة كل السطور. */
  bucketTotals: Record<RiskBucket, number>;
  signalCount: number;
  /** الإشارات اللي المراجع شالها (حكم `legitimate`) — بتتعد للشفافية مش للدرجة. */
  dismissedCount: number;
}

/**
 * الاضمحلال بالنوافذ مش بدالة أُسّية (ADR-0085 §3).
 *
 * السبب إن الرقم لازم يفضل **مفهوم لبني آدم**: «دي من شهرين فبتتحسب نص» جملة مراجع يقدر
 * يقولها لفني بيتعاقب. `exp(-λt)` مايتشرحش في مكالمة.
 */
export function decayFactor(ageDays: number): number {
  if (ageDays <= 30) return 1;
  if (ageDays <= 90) return 0.5;
  return 0.2;
}

/**
 * أثر حكم المراجع (ADR-0085 §4) — ده معنى «الـengine بيتعلم من البشر» بلا أي ML.
 *
 * `legitimate` بيصفّر المساهمة تمامًا: المراجع شاف الحادثة وقال إنها سليمة، فاستمرارها في
 * الدرجة معناه إن الشاشة بتجادل موظفيها.
 */
export function verdictFactor(verdict: RiskVerdict): number {
  switch (verdict) {
    case 'legitimate':
      return 0;
    case 'insufficient_evidence':
      // الشك قايم والدليل ناقص — نص وزن، مش صفر ومش كامل.
      return 0.5;
    case 'confirmed_abuse':
    case 'suspicious':
    case 'pending':
      return 1;
  }
}

/**
 * **أرضية التلاعب المؤكَّد**: إشارة اتأكد إنها تلاعب مابتنزلش تحت ٥٠٪ مهما قدمت.
 * تلاعب مثبت من سنة مش «تاريخ» — ده سابقة، والمراجع لازم يشوفها.
 */
const CONFIRMED_ABUSE_DECAY_FLOOR = 0.5;

export function levelFor(score: number): RiskLevel {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  if (score >= 30) return 'watch';
  return 'normal';
}

const EMPTY_BUCKET_TOTALS = (): Record<RiskBucket, number> => ({
  pricing_abuse: 0,
  parts_manipulation: 0,
  order_abuse: 0,
  off_platform_leakage: 0,
  customer_abuse: 0,
  collusion_fraud: 0,
});

/**
 * بيحسب الدرجة **ومعاها تفسيرها الكامل**.
 *
 * @param now لحظة التقييم — مُمرَّرة عمدًا مش `new Date()` جوّه، عشان الاختبار يقدر يثبّت
 *            الزمن ويقيس الاضمحلال بالظبط بدل ما يعتمد على ساعة النظام.
 */
export function calculateRiskScore(signals: ScorableSignal[], now: Date = new Date()): RiskScoreResult {
  const bucketTotals = EMPTY_BUCKET_TOTALS();
  let dismissedCount = 0;

  const lines: RiskScoreLine[] = signals.map((signal) => {
    const ageMs = now.getTime() - signal.occurredAt.getTime();
    // إشارة بتاريخ في المستقبل (اختلاف ساعات، أو بيانات مستوردة) بتتعامل كأنها النهاردة
    // بدل ما تدّي عمر سالب وعامل اضمحلال أكبر من ١.
    const ageDays = Math.max(0, ageMs / 86_400_000);
    const rawDecay = decayFactor(ageDays);
    const decay =
      signal.verdict === 'confirmed_abuse' ? Math.max(rawDecay, CONFIRMED_ABUSE_DECAY_FLOOR) : rawDecay;
    const verdictMultiplier = verdictFactor(signal.verdict);
    const contribution = round2(signal.weight * decay * verdictMultiplier);

    if (signal.verdict === 'legitimate') dismissedCount += 1;
    bucketTotals[signal.bucket] = round2(bucketTotals[signal.bucket] + contribution);

    return {
      signalId: signal.id,
      signalTypeCode: signal.signalTypeCode,
      bucket: signal.bucket,
      labelAr: signal.labelAr,
      baseWeight: signal.weight,
      ageDays: Math.round(ageDays),
      decayFactor: decay,
      verdict: signal.verdict,
      verdictFactor: verdictMultiplier,
      contribution,
      evidence: signal.evidence,
      orderId: signal.orderId ?? null,
    };
  });

  const total = lines.reduce((sum, line) => sum + line.contribution, 0);
  // **السقف ١٠٠ مش مجموع مفتوح**: الدرجة مقياس مقارنة بين ناس، مش عدّاد مخالفات. شخص بـ٣٠٠
  // مش «أخطر ٣ مرات» من شخص بـ١٠٠ — الاتنين في أعلى تصنيف والقرار واحد.
  const score = Math.min(100, Math.round(total));

  return {
    score,
    level: levelFor(score),
    lines: lines.sort((left, right) => right.contribution - left.contribution),
    bucketTotals,
    signalCount: signals.length,
    dismissedCount,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
