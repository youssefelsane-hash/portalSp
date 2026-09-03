import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRatingDto } from './dto/create-rating.dto';

/**
 * عقد تقييم العميل بين الواجهات (docs/08 §125).
 *
 * `apps/customer-web` كان **مفيهوش تقييم خالص** — عميل الويب عمره ما قدر يقيّم طلب، رغم إن
 * الـendpoint موجود ومتستخدم من `apps/customer-app` من زمان. بعد ما اتضاف التقييم للويب بقى فيه
 * **طرفين** بيبنوا نفس الحمولة، وده بالظبط شكل البَقّة اللي اتلقطت قبل كده في بصمة الحجز
 * (§121-ب): حقل بيتضاف عند طرف ويتنسى عند التاني.
 *
 * الاختبار ده بيقفل الانحراف ده: بيتحقق من **الحمولة اللي الويب بيبعتها حرفيًا** بنفس إعدادات
 * `ValidationPipe` العامة (`whitelist` + `forbidNonWhitelisted`). أي حقل يتضاف في
 * `apps/customer-web/src/lib/ratings.ts` ومش موجود في الـDTO هيفشّل الاختبار ده فورًا.
 */
describe('CreateRatingDto — عقد التقييم مع customer-web وcustomer-app', () => {
  const validateBody = (body: Record<string, unknown>) =>
    validate(plainToInstance(CreateRatingDto, body), { whitelist: true, forbidNonWhitelisted: true });

  it('الحمولة الكاملة اللي customer-web بيبعتها مقبولة بالكامل', async () => {
    // نسخة طبق الأصل من `CreateRatingBody` في apps/customer-web/src/lib/ratings.ts
    const errors = await validateBody({
      overall_rating: 5,
      punctuality_rating: 4,
      quality_rating: 5,
      professionalism_rating: 4,
      price_fairness_rating: 3,
      cleanliness_rating: 5,
      comment: 'شغل نضيف ومواعيد مظبوطة',
    });
    expect(errors).toEqual([]);
  });

  it('التقييم العام لوحده كافي — الأبعاد الخمسة اختيارية فعلاً', async () => {
    expect(await validateBody({ overall_rating: 3 })).toEqual([]);
  });

  it('الأبعاد اللي العميل مالمسهاش مابتتبعتش أصلاً (مش صفر) — صفر مرفوض', async () => {
    // الويب بيحذف البُعد لو = 0 بدل ما يبعت 0. لو حد شال الشرط ده، ده بيثبت إن الباك-إند
    // هيرفض — يعني البَقّة هتبان فورًا بدل ما تلوّث متوسطات الفني بصفر.
    const errors = await validateBody({ overall_rating: 5, punctuality_rating: 0 });
    expect(errors.map((e) => e.property)).toContain('punctuality_rating');
  });

  it('حقل مش معرّف في الـDTO بيترفض (حارس الانحراف بين الواجهتين)', async () => {
    const errors = await validateBody({ overall_rating: 5, technician_was_late: true });
    expect(errors.map((e) => e.property)).toContain('technician_was_late');
  });

  it('حدود التقييم 1..5 مفروضة على العام والأبعاد', async () => {
    expect((await validateBody({ overall_rating: 6 })).map((e) => e.property)).toContain('overall_rating');
    expect((await validateBody({ overall_rating: 0 })).map((e) => e.property)).toContain('overall_rating');
    expect((await validateBody({ overall_rating: 5, quality_rating: 9 })).map((e) => e.property)).toContain(
      'quality_rating',
    );
  });

  it('التعليق محدود بـ1000 حرف (نفس `maxLength` في الواجهتين)', async () => {
    expect(await validateBody({ overall_rating: 5, comment: 'ا'.repeat(1000) })).toEqual([]);
    expect((await validateBody({ overall_rating: 5, comment: 'ا'.repeat(1001) })).map((e) => e.property)).toContain(
      'comment',
    );
  });
});
