import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Canonical E.164 identity key; validation still decides whether the input is acceptable. */
export function normalizePhoneNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  // `010…`/`011…`/`012…`/`015…` بالشكل المحلي (docs/08 §189): الواجهات بتحوّله قبل النداء، ده دفاع
  // تاني لأي عميل قديم أو مباشر. مقصور على صيغة الموبايل المصري بالظبط — مفيش دولة افتراضية عامة.
  const compact = trimmed.replace(/[\s()-]/g, '');
  if (/^01[0125][0-9]{8}$/.test(compact)) return `+20${compact.slice(1)}`;
  return parsePhoneNumberFromString(trimmed)?.number ?? trimmed;
}
