import { AssignmentStatus } from './entities/order-assignment.entity';
import { resolveWorkloadGate, WorkloadGateInput } from './dispatch-route';

/**
 * **بوابتَي التحويل من التأكيد التلقائي للجولات** (بلاغ مالك 2026-09-17، docs/08 §156).
 *
 * > «بعض الطلبات تذهب كـRequest رغم أن الموعد ليس قريبًا، والفني يبدو متاحًا… هل هو invariant
 * >  مطلوب فعلًا أم sticky historical state يغير قرار الحاضر؟»
 *
 * الاختبار بينادي **`resolveWorkloadGate()` نفسها** — نفس الدالة اللي
 * `MatchingService.scheduledDispatchDecision()` بتنادي عليها. نسخة من المنطق في ملف الاختبار
 * كانت هتعدّي حتى لو الكود الحقيقي اتغيّر.
 *
 * ليه هنا مش في اختبار حي: `SettingsService` عنده كاش محلي (ثانيتين) فوق كاش Redis (٦٠ ثانية)،
 * فتبديل الإعداد وسط تشغيل حي بيدّي لقطة متأخّرة خطوة — اتلقط فعليًا. اختبار **فرع سياسة**
 * مالوش أي علاقة بتوقيت الكاش. المسار الكامل متغطّي في
 * `scripts/verify-dispatch-route-reasons.js`.
 */

/** العروض اللي لسه «حيّة» — نفس التعريف المستخدم في `matching.service.ts` بالحرف. */
const LIVE_ASSIGNMENT_STATUSES = [AssignmentStatus.SENT, AssignmentStatus.VIEWED];

/** `null` من الدالة معناها «مفيش سبب يمنع التأكيد التلقائي». */
const gate = (input: WorkloadGateInput) => resolveWorkloadGate(input);

describe('بوابة الحمل في قرار التوزيع (docs/08 §156)', () => {
  const base = { liveRequestCount: 0, hasOpenOffer: false, requiresIdleTechnician: false };

  describe('`existing_requests` — العروض الحيّة بس، مش تاريخ الطلب', () => {
    it('عرض مفتوح (sent/viewed) ⇒ الطلب يفضل في الجولات', () => {
      expect(gate({ ...base, liveRequestCount: 1, candidateTier: 'LIGHT' })).toEqual({ route: 'rounds', reason: 'existing_requests' });
      expect(gate({ ...base, hasOpenOffer: true, candidateTier: 'LIGHT' })).toEqual({ route: 'rounds', reason: 'existing_requests' });
    });

    /**
     * **البَقّة اللي البلاغ اتكتب عشانها**: العد كان `count()` بلا أي فلتر حالة، فعرض انتهت
     * مهلته من ساعتين — ميت ومالوش أي أثر — كان بيخلّي طلب معاده بعد أسبوع يفضل في الجولات للأبد.
     */
    it('عرض قديم منتهي/مرفوض **مش** سبب — التاريخ الميت مايغيّرش قرار الحاضر', () => {
      // `liveRequestCount = 0` هو بالظبط ناتج الفلترة على `sent`/`viewed` لصف حالته `timeout`.
      expect(gate({ ...base, liveRequestCount: 0, candidateTier: 'LIGHT' })).toBeNull();
    });

    it('«الحيّ» هنا هو نفس تعريف باقي محرك المطابقة — مش قايمة تانية', () => {
      expect(LIVE_ASSIGNMENT_STATUSES).toEqual([AssignmentStatus.SENT, AssignmentStatus.VIEWED]);
      expect(LIVE_ASSIGNMENT_STATUSES).not.toContain(AssignmentStatus.TIMEOUT);
      expect(LIVE_ASSIGNMENT_STATUSES).not.toContain(AssignmentStatus.REJECTED);
      expect(LIVE_ASSIGNMENT_STATUSES).not.toContain(AssignmentStatus.CANCELLED);
    });
  });

  describe('`same_day_workload` — التعارض الحقيقي، مش مجرد وجود شغل', () => {
    /**
     * `MEANINGFUL` معناها **بالتعريف** «عنده شغل تاني في اليوم تحت السقف وبلا أي تقاطع وقت».
     * الشخص ده عدّى `technicianAvailabilityCondition` وعشان كده ظهر للعميل أصلاً — فإجبار
     * الموافقة اليدوية عليه بيخلّي الحجز والتوزيع يجاوبوا إجابتين مختلفتين عن نفس السؤال.
     */
    it('حمل خفيف بلا تعارض (MEANINGFUL) ⇒ تأكيد تلقائي', () => {
      expect(gate({ ...base, candidateTier: 'MEANINGFUL' })).toBeNull();
    });

    it('الفاضي تمامًا (LIGHT) ⇒ تأكيد تلقائي — السلوك القديم محفوظ', () => {
      expect(gate({ ...base, candidateTier: 'LIGHT' })).toBeNull();
    });

    it('التعارض الحقيقي (HEAVY/BLOCKED) ⇒ جولات', () => {
      expect(gate({ ...base, candidateTier: 'HEAVY' })).toEqual({ route: 'rounds', reason: 'same_day_workload' });
      expect(gate({ ...base, candidateTier: 'BLOCKED' })).toEqual({ route: 'rounds', reason: 'same_day_workload' });
    });

    /**
     * **الضابط المضاد**: من غيره «كله تأكيد تلقائي» ممكن يبقى ناجح لأن الحارس اتشال بالكامل
     * بدل ما اتضيّق. الإعداد بيرجّع السلوك القديم بالحرف على **نفس المدخلات**.
     */
    it('الإعداد بيرجّع السلوك القديم: MEANINGFUL ⇒ جولات', () => {
      expect(gate({ ...base, candidateTier: 'MEANINGFUL', requiresIdleTechnician: true })).toEqual({
        route: 'rounds',
        reason: 'same_day_workload',
      });
      // و`LIGHT` بيفضل تأكيد تلقائي في الوضعين — الإعداد بيمسّ `MEANINGFUL` وبس.
      expect(gate({ ...base, candidateTier: 'LIGHT', requiresIdleTechnician: true })).toBeNull();
    });
  });

  it('مفيش مرشّح خالص ⇒ مفيش تصنيف يتبنى عليه قرار — القرار الأساسي بيفضل', () => {
    expect(gate({ ...base, candidateTier: null })).toBeNull();
  });
});
