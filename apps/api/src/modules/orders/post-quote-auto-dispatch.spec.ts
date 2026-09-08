import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **موافقة العميل على السعر = توزيع تلقائي فورًا** (طلب مالك صريح 2026-09-05).
 *
 * ## البَقّة اللي السبيك ده بيقفلها
 *
 * بعد ما الإدارة تسعّر التقييم بالصور والعميل يوافق، الطلب كان بيروح لـ
 * `AWAITING_TECHNICIAN_SELECTION` — «مستنيك تختار الفني». **والحالة دي طريق مسدود لكل عميل**:
 * مفيش أي شاشة في `customer-app` ولا `customer-web` بتنده `provider-candidates` ولا
 * `select-provider`. يعني رسالة بتطلب فعل مافيش زرار يعمله، والطلب بيقف للأبد.
 *
 * الصح: يدخل `SEARCHING_TECHNICIAN` ويتبعت `ORDER_CREATED_EVENT` — **نفس** نقطة الدخول اللي أي
 * طلب عادي بيتوزّع بيها (ADR-0018)، مش نظام موازي.
 *
 * الحارس ده بنيوي عمدًا: اختبار سلوكي كان هيحتاج تجهيز `InspectionQuoteService` بالكامل
 * (تسعير، دفع، فنيين، تدقيق)، والقيمة الحقيقية هنا إن **النمط** مايرجعش — مش إن الدالة اتنفّذت.
 */
describe('التوزيع التلقائي بعد موافقة العميل على السعر', () => {
  const read = (relative: string): string => readFileSync(join(__dirname, relative), 'utf8');

  /** الكود بلا تعليقات — التعليقات بتشرح النمط القديم بالاسم عمدًا. */
  const codeOf = (relative: string): string =>
    read(relative)
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');

  it('الموافقة مابتحطّش الطلب في حالة اختيار المنفّذ — الحالة دي مالهاش شاشة عند العميل', () => {
    // الذِكر الباقي في الملف هو فحص idempotency للطلبات القديمة (قراءة)، مش إسناد (كتابة).
    expect(codeOf('./inspection-quote.service.ts')).not.toMatch(/=\s*OrderStatus\.AWAITING_TECHNICIAN_SELECTION/);
    expect(codeOf('./inspection-quote.service.ts')).not.toMatch(/\?\s*OrderStatus\.AWAITING_TECHNICIAN_SELECTION/);
  });

  it('الموافقة بتبعت ORDER_CREATED_EVENT — نقطة دخول التوزيع الموحّدة (ADR-0018)', () => {
    const code = codeOf('./inspection-quote.service.ts');
    expect(code).toMatch(/SEARCHING_TECHNICIAN/);
    expect(code).toMatch(/emitAsync\(ORDER_CREATED_EVENT/);
  });

  it('ضياع المنفّذ بيرجّع الطلب لحالة ليها شاشة (إعادة اختيار) مش لحالة الطريق المسدود', () => {
    const code = codeOf('../matching/matching.service.ts');
    expect(code).not.toMatch(/AWAITING_TECHNICIAN_SELECTION/);
    expect(code).toMatch(/AWAITING_TECHNICIAN_RESELECTION/);
  });

  /**
   * الحارس ده هو اللي بيمنع رجوع الطريق المسدود من أي مكان تاني: أي كود بيحط الطلب في
   * `AWAITING_TECHNICIAN_SELECTION` لازم يبقى معاه شاشة عند العميل. طول ما مفيش، الحالة
   * مقصورة على خدمة الاختيار نفسها (اللي الأدمن/العمليات بينادوها) وآلة الحالات.
   */
  it('مفيش أي كود بيسند الحالة دي لطلب غير خدمة الاختيار نفسها', () => {
    // الملفات المسموح لها: خدمة الاختيار (الأدمن/العمليات بينادوها صراحةً)، آلة الحالات
    // (بتعرّف الانتقالات مش بتسند)، ونصوص الإشعارات (بتوصف الحالة للطلبات القديمة).
    const allowed = [
      'post-quote-provider-selection.service.ts',
      'order-state-machine.ts',
      'order-status-notification.listener.ts',
      'inspection-quote.service.ts',
    ];
    const hits = execSync(
      `grep -rlE "=[[:space:]]*OrderStatus\\.AWAITING_TECHNICIAN_SELECTION" ${join(__dirname, '../..')} --include="*.ts" || true`,
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .map((full) => full.split('/').pop() as string)
      .filter((name) => !name.endsWith('.spec.ts') && !allowed.includes(name));
    expect(hits).toEqual([]);
  });
});
