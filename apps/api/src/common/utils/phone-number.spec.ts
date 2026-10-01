import { normalizePhoneNumber } from './phone-number';

describe('normalizePhoneNumber — الشكل المحلي المصري (docs/08 §189)', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['01112345678', '+201112345678'],
    ['01212345678', '+201212345678'],
    ['01512345678', '+201512345678'],
    [' 010 1234 5678 ', '+201012345678'],
    ['010-1234-5678', '+201012345678'],
  ])('%s ⇒ %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it('E.164 بيفضل زي ما هو (نفس هوية الحساب)', () => {
    expect(normalizePhoneNumber('+201012345678')).toBe('+201012345678');
  });

  it('بادئة مش موبايل مصري (013/014/016) مابتتحوّلش — التحقق يرفضها زي الأول', () => {
    expect(normalizePhoneNumber('01312345678')).toBe('01312345678');
    expect(normalizePhoneNumber('0101234567')).toBe('0101234567');
  });

  it('قيمة مش نص بترجع زي ما هي', () => {
    expect(normalizePhoneNumber(undefined)).toBeUndefined();
  });
});
