export const REVISIT_EARLIEST_VISIT_DAYS = 3;
export const REVISIT_LATEST_VISIT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * إعادة الزيارة تُرسل للفني فورًا، لكن موعد تنفيذها الافتراضي بعد ثلاثة أيام.
 * الحساب من وقت إنشاء الطلب يحافظ على نفس الساعة ويمنع تحويل الضمان لطلب فوري.
 */
export function defaultRevisitScheduledAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + REVISIT_EARLIEST_VISIT_DAYS * DAY_MS);
}
