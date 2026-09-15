import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProposeQuoteItemsDto } from './dto/propose-quote-items.dto';
import { SubmitInitialQuoteDto } from './dto/submit-initial-quote.dto';
import { validationErrorsToArabic } from '../../http-bootstrap';

/**
 * **عقد الحمولة اللي تطبيق الفني بيبعتها فعلاً** — الاختبار اللي كان هيمنع بلاغ المالك
 * (2026-09-13: «الصنايعي بيحاول يضيف قطعة غيار فيقوله البيانات المرسلة غير صحيحة»).
 *
 * ## ليه الاختبار ده موجود
 *
 * ADR-0084 §2 خلّى `description`/`diagnosis` إجباريين في الـDTO. الـbackend كله عدّى (tsc،
 * eslint، 2200 اختبار) لأن كل الاختبارات بتبني الحمولة **من الـDTO نفسه** — فلما الحقل بقى
 * إجباري، الاختبارات اتعدّلت معاه واتفقوا على نفس الغلط. اللي مامسكوش حاجة إن
 * `apps/technician-app` مكانش بيبعت الحقل ده أصلاً، فكل محاولة حقيقية من الفني بقت بتترفض.
 *
 * القاعدة اللي بيثبّتها: **الحمولة هنا متكتوبة زي ما الـDart بيبنيها بالحرف**، مش زي ما الـDTO
 * بيحب. أي تشديد جديد على العقد لازم يكسر الاختبار ده الأول — وده الغرض منه.
 *
 * المصدر: `apps/technician-app/lib/features/orders/order_execution_screen.dart`
 * (`_proposeQuoteItems` و`_submitInitialQuote`).
 */
describe('عقد حمولة تطبيق الفني للأفعال المالية (بلاغ 2026-09-13)', () => {
  const validate = <T extends object>(cls: new () => T, payload: object) =>
    validateSync(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: true });

  describe('اقتراح بنود إضافية — POST /technician/orders/:id/quote-items', () => {
    /** نسخة حرفية من الـmap اللي بيتبني في `_proposeQuoteItems`. */
    const payloadFromApp = (overrides: Partial<Record<string, unknown>> = {}) => ({
      items: [
        {
          item_type: 'spare_part',
          name_ar: 'مواسير نحاس',
          description: 'المواسير القديمة متآكلة والتسريب طالع من عندها',
          quantity: 2,
          unit_price_cents: 15000,
          ...overrides,
        },
      ],
    });

    it('الحمولة اللي التطبيق بيبعتها بتعدّي العقد', () => {
      expect(validate(ProposeQuoteItemsDto, payloadFromApp())).toHaveLength(0);
    });

    it('كل الأنواع التلاتة اللي الواجهة بتعرضها مقبولة', () => {
      for (const item_type of ['spare_part', 'extra_labor', 'addon']) {
        expect(validate(ProposeQuoteItemsDto, payloadFromApp({ item_type }))).toHaveLength(0);
      }
    });

    it('الكمية العشرية (الواجهة بتقبل كسور) مقبولة', () => {
      expect(validate(ProposeQuoteItemsDto, payloadFromApp({ quantity: 1.5 }))).toHaveLength(0);
    });

    /**
     * **ده الصف اللي بيثبّت البلاغ نفسه**: من غير `description` الحمولة بتترفض، والرسالة
     * اللي كان الفني بيشوفها كانت عامة تمامًا.
     */
    it('من غير سبب البند بتترفض — والرسالة بقت بتسمّي الحقل بدل ما تسدّ الباب', () => {
      const withoutDescription = payloadFromApp();
      delete (withoutDescription.items[0] as Record<string, unknown>).description;

      const errors = validate(ProposeQuoteItemsDto, withoutDescription);
      expect(errors.length).toBeGreaterThan(0);

      const message = validationErrorsToArabic(errors);
      expect(message).toContain('سبب البند');
      expect(message).not.toBe('البيانات المرسلة غير صحيحة');
    });

    it('سبب أقصر من الحد بيدّي رسالة بتسمّي الحقل كمان (isLength كان ناقص من الخريطة أصلاً)', () => {
      const message = validationErrorsToArabic(validate(ProposeQuoteItemsDto, payloadFromApp({ description: 'قصير' })));
      expect(message).toContain('سبب البند');
      expect(message).not.toBe('البيانات المرسلة غير صحيحة');
    });
  });

  describe('أول سعر بعد المعاينة — POST /technician/orders/:id/initial-quote', () => {
    /** نسخة حرفية من `_submitInitialQuote` بعد الإصلاح: التشخيص بيتبعت من نفس خانة السبب. */
    const payloadFromApp = (overrides: Partial<Record<string, unknown>> = {}) => ({
      quoted_amount_cents: 120000,
      note: 'تغيير الكومبريسور وشحن فريون',
      diagnosis: 'الكومبريسور بايظ بالكامل والفريون فاضي',
      ...overrides,
    });

    it('الحمولة اللي التطبيق بيبعتها بتعدّي العقد', () => {
      expect(validate(SubmitInitialQuoteDto, payloadFromApp())).toHaveLength(0);
    });

    it('التشخيص الفاضي (السلوك القديم للتطبيق) بيترفض برسالة بتسمّي الحقل', () => {
      const withoutDiagnosis = payloadFromApp();
      delete (withoutDiagnosis as Record<string, unknown>).diagnosis;

      const errors = validate(SubmitInitialQuoteDto, withoutDiagnosis);
      expect(errors.length).toBeGreaterThan(0);
      expect(validationErrorsToArabic(errors)).toContain('التشخيص');
    });
  });

  /**
   * الحارس العام: `@Length()` مستخدمة في ٩٥ مكان في الـDTOs، و`isLength` كان **ناقص بالكامل**
   * من خريطة الرسايل — يعني كل مخالفة طول في الـAPI كلها كانت بتطلع الرسالة العامة.
   */
  it('مخالفة الطول مابترجعش الرسالة العامة المسدودة', () => {
    const errors = validate(SubmitInitialQuoteDto, { quoted_amount_cents: 1000, diagnosis: 'x' });
    expect(validationErrorsToArabic(errors)).not.toBe('البيانات المرسلة غير صحيحة');
  });
});
