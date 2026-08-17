import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Canonical E.164 identity key; validation still decides whether the input is acceptable. */
export function normalizePhoneNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return parsePhoneNumberFromString(trimmed)?.number ?? trimmed;
}
