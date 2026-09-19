import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEVEL_LABELS,
  PRICING_TIER_LABELS,
  WAGE_SKILL_LABELS,
  wageSkillLabel,
} from '../src/lib/technician-labels.ts';

/**
 * **تلات سلالم، وممنوع أي كلمة مشتركة بينهم** (docs/08 §171).
 *
 * فئة سعر الفني وعامل أجر المهارة كانوا بيتعرضوا بنفس التلات كلمات بالحرف (مبتدئ/قياسي/خبير)،
 * فالأدمن اللي بيظبط «خبير» مكانش عارف هو بيغلي على العميل ولا بيزوّد أجر الفني. الاختبار ده
 * بيمنع رجوع اللبس: أي واحد يحط كلمة في سلّم وهي موجودة في التاني، السويت بتقع.
 */
const values = (map) => Object.values(map);

test('فئة السعر وأجر المهارة مفيش بينهم ولا كلمة مشتركة', () => {
  const pricing = new Set(values(PRICING_TIER_LABELS));
  const shared = values(WAGE_SKILL_LABELS).filter((label) => pricing.has(label));
  assert.deepEqual(shared, [], `كلمات مشتركة بين سلّم السعر وسلّم الأجر: ${shared.join(' · ')}`);
});

test('والرتبة التشغيلية كمان منفصلة عن الاتنين', () => {
  const others = new Set([...values(PRICING_TIER_LABELS), ...values(WAGE_SKILL_LABELS)]);
  const shared = values(LEVEL_LABELS).filter((label) => others.has(label));
  assert.deepEqual(shared, [], `الرتبة بتشارك كلمات مع سلّم تاني: ${shared.join(' · ')}`);
});

test('سلّم الأجر لسه بتلات درجات مطابقة لقيم الـenum في القاعدة', () => {
  // القيم دي هي `skill_level` بالحرف — أي زيادة هنا لازم يقابلها migration وقرار عامل أجر.
  assert.deepEqual(Object.keys(WAGE_SKILL_LABELS), ['beginner', 'standard', 'expert']);
});

test('سلّم السعر بأربع درجات بترتيبها (migration 0355)', () => {
  assert.deepEqual(Object.keys(PRICING_TIER_LABELS), ['beginner', 'standard', 'advanced', 'expert']);
});

test('لقطة قديمة أو قيمة مش معروفة بترجع خام بدل ما الخانة تفضى', () => {
  assert.equal(wageSkillLabel('expert'), 'متمكّن');
  assert.equal(wageSkillLabel('senior'), 'senior');
  assert.equal(wageSkillLabel(null), '—');
  assert.equal(wageSkillLabel(undefined), '—');
});
