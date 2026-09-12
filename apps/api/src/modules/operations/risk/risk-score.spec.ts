import { calculateRiskScore, decayFactor, levelFor, verdictFactor, type ScorableSignal } from './risk-score';

/**
 * محرك درجة المخاطر — **الجزء اللي بيتعاقب عليه إنسان، فلازم يكون قابل للإعادة بالورقة والقلم**.
 *
 * الاختبارات دي بتثبّت الزمن (`now` مُمرَّر) بدل ما تعتمد على ساعة النظام: اختبار اضمحلال
 * بيقرا `new Date()` بيعدّي أو يفشل حسب وقت التشغيل، وده أسوأ من عدم وجوده.
 */
describe('درجة المخاطر — الحساب والتفسير', () => {
  const NOW = new Date('2026-09-12T12:00:00Z');
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  const signal = (over: Partial<ScorableSignal> = {}): ScorableSignal => ({
    id: over.id ?? 'sig-1',
    signalTypeCode: over.signalTypeCode ?? 'price_increase_rate_vs_peers',
    bucket: over.bucket ?? 'pricing_abuse',
    labelAr: over.labelAr ?? 'زيادة سعر',
    weight: over.weight ?? 20,
    occurredAt: over.occurredAt ?? daysAgo(1),
    verdict: over.verdict ?? 'pending',
    evidence: over.evidence ?? {},
    orderId: over.orderId ?? null,
  });

  describe('الاضمحلال بالنوافذ', () => {
    it('≤٣٠ يوم وزن كامل، ٣١–٩٠ نص، وأقدم من كده خُمس', () => {
      expect(decayFactor(0)).toBe(1);
      expect(decayFactor(30)).toBe(1);
      expect(decayFactor(31)).toBe(0.5);
      expect(decayFactor(90)).toBe(0.5);
      expect(decayFactor(91)).toBe(0.2);
      expect(decayFactor(400)).toBe(0.2);
    });

    it('إشارة من شهرين بتساهم بنص وزنها بالظبط', () => {
      const result = calculateRiskScore([signal({ weight: 40, occurredAt: daysAgo(60) })], NOW);
      expect(result.score).toBe(20);
      expect(result.lines[0].decayFactor).toBe(0.5);
      expect(result.lines[0].ageDays).toBe(60);
    });

    it('**تاريخ في المستقبل مابيدّيش وزن أكبر من ١**', () => {
      // اختلاف ساعات بين خوادم، أو بيانات مستوردة — مايصحش يخلّي إشارة تساهم أكتر من وزنها.
      const result = calculateRiskScore(
        [signal({ weight: 30, occurredAt: new Date(NOW.getTime() + 5 * 86_400_000) })], NOW);
      expect(result.lines[0].decayFactor).toBe(1);
      expect(result.score).toBe(30);
    });
  });

  describe('أثر حكم المراجع', () => {
    it('«مشروعة» بتتشال من الحساب تمامًا — الشاشة مابتجادلش موظفيها', () => {
      const result = calculateRiskScore([
        signal({ id: 'a', weight: 40, verdict: 'legitimate' }),
        signal({ id: 'b', weight: 20, verdict: 'pending' }),
      ], NOW);
      expect(result.score).toBe(20);
      expect(result.dismissedCount).toBe(1);
      expect(result.lines.find((l) => l.signalId === 'a')?.contribution).toBe(0);
    });

    it('«دليل غير كافٍ» بتساهم بالنص — الشك قايم والإثبات ناقص', () => {
      expect(verdictFactor('insufficient_evidence')).toBe(0.5);
      const result = calculateRiskScore([signal({ weight: 30, verdict: 'insufficient_evidence' })], NOW);
      expect(result.score).toBe(15);
    });

    it('**التلاعب المؤكَّد مابينزلش تحت نص وزنه مهما قدم** — ده سابقة مش تاريخ', () => {
      const old = calculateRiskScore(
        [signal({ weight: 40, occurredAt: daysAgo(400), verdict: 'confirmed_abuse' })], NOW);
      expect(old.lines[0].decayFactor).toBe(0.5);
      expect(old.score).toBe(20);

      // نفس العمر بحكم «معلّق» بيضمحل لـ٢٠٪ عادي — الأرضية للمؤكَّد بس.
      const pending = calculateRiskScore(
        [signal({ weight: 40, occurredAt: daysAgo(400), verdict: 'pending' })], NOW);
      expect(pending.lines[0].decayFactor).toBe(0.2);
      expect(pending.score).toBe(8);
    });
  });

  describe('التفسير إجباري', () => {
    it('كل إشارة ليها سطر بمساهمتها ودليلها، مرتّبة بالأهم', () => {
      const result = calculateRiskScore([
        signal({ id: 'small', weight: 10, labelAr: 'صغيرة' }),
        signal({ id: 'big', weight: 35, labelAr: 'كبيرة', evidence: { measured_pct: 61, peer_median_pct: 9 } }),
      ], NOW);

      expect(result.lines).toHaveLength(2);
      // الأهم فوق — المراجع بيقرا أول سطرين ويفهم.
      expect(result.lines[0].signalId).toBe('big');
      expect(result.lines[0].evidence).toEqual({ measured_pct: 61, peer_median_pct: 9 });
      expect(result.lines[0].contribution + result.lines[1].contribution).toBe(45);
    });

    it('مجاميع الـbuckets بتقول نوع التلاعب الغالب بلا قراءة كل السطور', () => {
      const result = calculateRiskScore([
        signal({ id: '1', bucket: 'pricing_abuse', weight: 20 }),
        signal({ id: '2', bucket: 'pricing_abuse', weight: 15 }),
        signal({ id: '3', bucket: 'order_abuse', weight: 10 }),
      ], NOW);
      expect(result.bucketTotals.pricing_abuse).toBe(35);
      expect(result.bucketTotals.order_abuse).toBe(10);
      expect(result.bucketTotals.collusion_fraud).toBe(0);
    });
  });

  describe('المستويات والسقف', () => {
    it('حدود المستويات مطابقة للمتفق عليه', () => {
      expect(levelFor(0)).toBe('normal');
      expect(levelFor(29)).toBe('normal');
      expect(levelFor(30)).toBe('watch');
      expect(levelFor(49)).toBe('watch');
      expect(levelFor(50)).toBe('medium');
      expect(levelFor(69)).toBe('medium');
      expect(levelFor(70)).toBe('high');
      expect(levelFor(84)).toBe('high');
      expect(levelFor(85)).toBe('critical');
      expect(levelFor(100)).toBe('critical');
    });

    it('**الدرجة مسقوفة عند ١٠٠**: شخص بـ٣٠٠ مش أخطر ٣ مرات من شخص بـ١٠٠', () => {
      const many = Array.from({ length: 20 }, (_, i) => signal({ id: `s${i}`, weight: 30 }));
      const result = calculateRiskScore(many, NOW);
      expect(result.score).toBe(100);
      expect(result.level).toBe('critical');
      // التفسير بيفضل كامل رغم السقف — المراجع لازم يشوف كل الأسباب مش ٣ منهم.
      expect(result.lines).toHaveLength(20);
    });

    it('بلا إشارات = صفر وعادي — مش «مجهول» ولا فراغ', () => {
      const result = calculateRiskScore([], NOW);
      expect(result.score).toBe(0);
      expect(result.level).toBe('normal');
      expect(result.lines).toEqual([]);
      expect(result.signalCount).toBe(0);
    });

    it('كل الإشارات «مشروعة» = صفر — الشخص ده مش في الطابور أصلاً', () => {
      const result = calculateRiskScore([
        signal({ id: 'a', weight: 50, verdict: 'legitimate' }),
        signal({ id: 'b', weight: 50, verdict: 'legitimate' }),
      ], NOW);
      expect(result.score).toBe(0);
      expect(result.dismissedCount).toBe(2);
    });
  });
});
