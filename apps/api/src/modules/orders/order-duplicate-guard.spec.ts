import { CreateOrderDto } from './dto/create-order.dto';
import { autoIdempotencyKeys } from './order-duplicate-guard';

/**
 * تدقيق `docs/29` P0-4 — «مفيش حماية فعلية من الدوسة المزدوجة».
 *
 * `Idempotency-Key` كان موجود بس **اختياري**، فأي كلاينت مش بيبعته (تطبيق قديم، متصفح، تكامل
 * خارجي) بيعمل طلبين لو العميل دَس مرتين. اتأكد حيًا: طلبين متوازيين بنفس الـbody = طلبين.
 *
 * الاختبارات دي بتقفل على **عقد اشتقاق المفتاح** نفسه — هو اللي كل الحماية قايمة عليه.
 */
describe('حماية الدوسة المزدوجة — اشتقاق مفتاح idempotency', () => {
  const CUSTOMER = '01a00000-0000-7000-8000-000000000001';
  const base = (): CreateOrderDto =>
    ({
      service_id: '01a00000-0000-7000-8000-0000000000aa',
      address_id: '01a00000-0000-7000-8000-0000000000bb',
      scheduled_at: '2026-10-01T09:00:00.000Z',
      problem_description: 'الحنفية بتنقّط من تحت الحوض',
    }) as CreateOrderDto;

  it('نفس الطلب بالظبط في نفس اللحظة ⇒ نفس المفتاح (الدوسة التانية بترجّع الطلب الأصلي)', () => {
    const now = 1_800_000_000_000;
    const [a] = autoIdempotencyKeys(CUSTOMER, base(), now, 90);
    const [b] = autoIdempotencyKeys(CUSTOMER, base(), now + 300, 90);
    expect(a).toBe(b);
  });

  it('ترتيب مفاتيح الـDTO مش بيغيّر البصمة — كلاينتات مختلفة بتبعت نفس الحقول بترتيب مختلف', () => {
    const now = 1_800_000_000_000;
    const ordered = {
      service_id: base().service_id,
      address_id: base().address_id,
      scheduled_at: base().scheduled_at,
      problem_description: base().problem_description,
    } as CreateOrderDto;
    const shuffled = {
      problem_description: base().problem_description,
      scheduled_at: base().scheduled_at,
      address_id: base().address_id,
      service_id: base().service_id,
    } as CreateOrderDto;
    expect(autoIdempotencyKeys(CUSTOMER, ordered, now, 90)[0]).toBe(autoIdempotencyKeys(CUSTOMER, shuffled, now, 90)[0]);
  });

  it.each([
    ['خدمة مختلفة', { service_id: '01a00000-0000-7000-8000-0000000000ff' }],
    ['عنوان مختلف', { address_id: '01a00000-0000-7000-8000-0000000000ff' }],
    ['موعد مختلف', { scheduled_at: '2026-10-02T09:00:00.000Z' }],
    ['وصف مشكلة مختلف', { problem_description: 'الكهربا فاصلة في المطبخ' }],
    ['كمية مختلفة', { pricing_quantity: 3 }],
  ])('طلب مختلف فعلًا (%s) ⇒ مفتاح مختلف، فمابيتمنعش', (_label, patch) => {
    const now = 1_800_000_000_000;
    const original = autoIdempotencyKeys(CUSTOMER, base(), now, 90)[0];
    const changed = autoIdempotencyKeys(CUSTOMER, { ...base(), ...patch } as CreateOrderDto, now, 90)[0];
    expect(changed).not.toBe(original);
  });

  it('عميل تاني بنفس الطلب ⇒ مفتاح مختلف — الحماية للعميل مش للنظام كله', () => {
    const now = 1_800_000_000_000;
    const mine = autoIdempotencyKeys(CUSTOMER, base(), now, 90)[0];
    const theirs = autoIdempotencyKeys('01a00000-0000-7000-8000-000000000002', base(), now, 90)[0];
    expect(theirs).not.toBe(mine);
  });

  it('بعد ما النافذة تعدّي ⇒ مفتاح جديد، فالعميل يقدر يطلب نفس الحاجة تاني', () => {
    const now = 1_800_000_000_000;
    const first = autoIdempotencyKeys(CUSTOMER, base(), now, 90)[0];
    const later = autoIdempotencyKeys(CUSTOMER, base(), now + 200_000, 90)[0];
    expect(later).not.toBe(first);
  });

  it('الشريحة السابقة مرجّعة كمان — دوستين على حدّي شريحتين لازم يتمسكوا', () => {
    const windowSeconds = 90;
    // لحظة على بعد ٥٠ملي ثانية بعد بداية شريحة جديدة: الدوسة الأولى وقعت في الشريحة اللي فاتت.
    const boundary = Math.ceil(1_800_000_000_000 / (windowSeconds * 1000)) * windowSeconds * 1000;
    const [, previousOfSecond] = autoIdempotencyKeys(CUSTOMER, base(), boundary + 50, windowSeconds);
    const [currentOfFirst] = autoIdempotencyKeys(CUSTOMER, base(), boundary - 50, windowSeconds);
    expect(previousOfSecond).toBe(currentOfFirst);
  });

  it('المفتاح بيفضل جوّه حد العمود VARCHAR(80) (migration 0139)', () => {
    const keys = autoIdempotencyKeys(CUSTOMER, base(), Date.now(), 90);
    keys.forEach((key) => expect(key.length).toBeLessThanOrEqual(80));
  });
});
