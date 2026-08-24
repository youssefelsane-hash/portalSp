import { RecurringOrderFrequency } from './entities/recurring-order-template.entity';

// حساب الموعد التالي للقالب المتكرر — منطق واحد مشترك بين RecurringOrdersService (التوليد
// الدوري) وOrdersService.create() (إنشاء خطة من مسار الحجز العادي) عشان مفيش نسختين من نفس
// قاعدة التكرار يقدروا يختلفوا عن بعض مع الوقت.
//
// آخر يوم فعلي في شهر (UTC) — بيتحسب بـ"اليوم صفر" من الشهر اللي بعده (خدعة JS Date معروفة).
function lastDayOfUtcMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

// كانت بَقّة حقيقية: `setMonth(getMonth() + 1)`/`setFullYear(getFullYear() + 1)` بتفيض بصمت لو
// اليوم مش موجود في الشهر الجديد (31 يناير + شهر = JS بتحسبها "31 فبراير" فتتدحرج لـ3 مارس، مش
// آخر يوم في فبراير زي المتوقع؛ 29 فبراير (سنة كبيسة) + سنة = 1 مارس مش 28 فبراير). الأثر: طلب
// متكرر شهري مضبوط يوم 29/30/31 كان بيتزحلق تاريخه شهر بعد شهر بدل ما يفضل ثابت على آخر يوم في
// الشهر. الإصلاح: نحسب الشهر/السنة الجديدة على "اليوم 1" الأول (مفيش فيضان ممكن)، وبعدين نـclamp
// اليوم المطلوب لآخر يوم فعلي في الشهر الجديد.
export function nextOccurrence(from: Date, frequency: RecurringOrderFrequency): Date {
  const day = from.getUTCDate();
  switch (frequency) {
    case RecurringOrderFrequency.WEEKLY: {
      const next = new Date(from);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }
    case RecurringOrderFrequency.MONTHLY: {
      const year = from.getUTCFullYear();
      const monthIndex0 = from.getUTCMonth() + 1;
      const clampedDay = Math.min(day, lastDayOfUtcMonth(year, monthIndex0));
      const next = new Date(from);
      next.setUTCFullYear(year, monthIndex0, clampedDay);
      return next;
    }
    case RecurringOrderFrequency.YEARLY: {
      const year = from.getUTCFullYear() + 1;
      const monthIndex0 = from.getUTCMonth();
      const clampedDay = Math.min(day, lastDayOfUtcMonth(year, monthIndex0));
      const next = new Date(from);
      next.setUTCFullYear(year, monthIndex0, clampedDay);
      return next;
    }
  }
}
