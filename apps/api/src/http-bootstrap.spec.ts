import { validationErrorsToArabic } from './http-bootstrap';

describe('validationErrorsToArabic', () => {
  it.each([
    ['isUuid', 'الحقل غير صحيح أو الرابط قديم'],
    ['maxLength', 'الحقل أطول من الحد المسموح'],
    ['isEnum', 'الحقل يحتوي اختيارًا غير مسموح'],
    ['isDateString', 'الحقل لازم يكون تاريخًا صحيحًا'],
    ['isPositive', 'الحقل لازم يكون رقمًا أكبر من صفر'],
    ['whitelistValidation', 'الحقل غير مسموح'],
  ])('translates %s without leaking validator internals', (constraint, expected) => {
    expect(validationErrorsToArabic([{ property: 'internal_field', constraints: { [constraint]: 'English framework text' } }])).toBe(expected);
  });
});
