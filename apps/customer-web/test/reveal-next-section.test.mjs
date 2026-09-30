import assert from 'node:assert/strict';
import test from 'node:test';
import { revealScrollDelta } from '../src/lib/reveal-next-section.ts';

// نفس حالات `apps/customer-app/test/reveal_next_section_test.dart`.
test('الجزء تحت الشاشة ⇒ أقل تمرير يبيّن آخره', () => {
  assert.equal(revealScrollDelta({ top: 900, bottom: 1100 }, 844, 96), 1100 + 24 - 844);
});

test('الجزء باين أصلاً ⇒ مفيش حركة', () => {
  assert.equal(revealScrollDelta({ top: 300, bottom: 600 }, 844, 96), 0);
});

test('الجزء أطول من الشاشة ⇒ بنوقف عند أوله (تحت الهيدر) مش آخره', () => {
  assert.equal(revealScrollDelta({ top: 700, bottom: 2400 }, 844, 96), 700 - 96);
});

test('الجزء فوق (العميل نزل بنفسه) ⇒ مابنطلعش بيه لفوق', () => {
  assert.equal(revealScrollDelta({ top: -400, bottom: -100 }, 844, 96), 0);
});
