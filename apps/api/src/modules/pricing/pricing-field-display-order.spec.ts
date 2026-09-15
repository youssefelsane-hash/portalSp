/**
 * حارس ترتيب حقول الفورم الديناميكي (بلاغ المالك 2026-09-15، docs/08 §149).
 *
 * الفئة اللي بيقفلها: الخاصية كانت شغالة **بالعكس**. الأدمن بيضيف حقوله من غير ما يلمس خانة
 * الترتيب فكلهم بياخدوا صفر؛ وبعدين لما يقول «الحقل ده يبقى الأول» ويكتب ١، الرقم ١ بيبقى
 * أكبر من كل الأصفار فالحقل ينزل آخر واحد. اتعاد إنتاجه حيًا: حقل ترتيبه «١» ظهر في المكان ٩
 * من ٩.
 *
 * الاختبار ده على المنطق المجرّد عمدًا (بلا قاعدة بيانات): القاعدتين اللي الإصلاح بيقوم
 * عليهم — «الجديد بيتحط في الآخر» و«المتعادلين بترتيب الإضافة» — قابلين للتعبير كدالتين
 * نقيّتين، والتحقق الحي على API حقيقي موجود في `scripts/` ومتسجّل في docs/08 §149.
 */

/** نفس قاعدة `PricingFieldsService.nextDisplayOrder`. */
function nextDisplayOrder(existingOrders: number[]): number {
  return Math.max(0, ...existingOrders) + 1;
}

/** نفس قاعدة `listForService`: الرقم الأصغر الأول، والمتعادلين بترتيب الإضافة. */
function sortForDisplay<T extends { displayOrder: number; createdAt: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.displayOrder - b.displayOrder || a.createdAt - b.createdAt);
}

describe('ترتيب حقول الفورم الديناميكي', () => {
  it('الحقل الجديد بلا ترتيب بيتحط في آخر الطابور مش على صفر', () => {
    expect(nextDisplayOrder([])).toBe(1);
    expect(nextDisplayOrder([1, 2, 3])).toBe(4);
    expect(nextDisplayOrder([5])).toBe(6);
  });

  it('**بلاغ المالك** بالسلوك القديم: كلهم أصفار + واحد اتحطّله ١ ⇒ ينزل آخر واحد', () => {
    // السلوك المكسور: `displayOrder: dto.display_order ?? 0` لكل حقل
    const broken = Array.from({ length: 9 }, (_, i) => ({ key: `f${i + 1}`, displayOrder: 0, createdAt: i }));
    broken[8].displayOrder = 1; // الأدمن عايزه الأول

    const orderedBroken = sortForDisplay(broken);
    expect(orderedBroken[orderedBroken.length - 1].key).toBe('f9'); // طلع آخر واحد — ده البلاغ
  });

  it('بعد الإصلاح: ترتيب حقيقي ١..ن، والرقم الأصغر بيطلع فوق', () => {
    // بقاعدة الإصلاح الحقول بتتضاف بأرقام متتابعة
    const rows = Array.from({ length: 9 }, (_, i) => ({ key: `f${i + 1}`, displayOrder: i + 1, createdAt: i }));
    // الأدمن عايز التاسع يطلع فوق ⇒ بيحطله رقم أصغر من كل اللي فوقه
    rows[8].displayOrder = 0;

    const ordered = sortForDisplay(rows);
    expect(ordered[0].key).toBe('f9');
  });

  it('التعادل على نفس الرقم بيتحسم بترتيب الإضافة — مش عشوائي', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ key: `f${i + 1}`, displayOrder: i + 1, createdAt: i }));
    rows[8].displayOrder = 1; // اتعادل مع f1

    const ordered = sortForDisplay(rows);
    expect(ordered.slice(0, 2).map((r) => r.key)).toEqual(['f1', 'f9']); // الأقدم الأول، وبعده اللي اتعدّل
    expect(ordered[2].key).toBe('f2'); // وباقي الترتيب زي ما هو
  });

  it('الأصفار المتساوية (البيانات القديمة) بتفضل بترتيب إضافتها مش عشوائي', () => {
    const rows = [
      { key: 'c', displayOrder: 0, createdAt: 3 },
      { key: 'a', displayOrder: 0, createdAt: 1 },
      { key: 'b', displayOrder: 0, createdAt: 2 },
    ];
    expect(sortForDisplay(rows).map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });

  it('الترتيب الصريح بيغلب تاريخ الإضافة', () => {
    const rows = [
      { key: 'قديم', displayOrder: 3, createdAt: 1 },
      { key: 'جديد', displayOrder: 1, createdAt: 9 },
    ];
    expect(sortForDisplay(rows).map((r) => r.key)).toEqual(['جديد', 'قديم']);
  });
});
