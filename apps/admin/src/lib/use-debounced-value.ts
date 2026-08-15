import { useEffect, useState } from 'react';

/**
 * بيرجّع نسخة متأخرة من `value` — بتتحدّث بس بعد ما المستخدم يوقف عن الكتابة لمدة `delayMs`.
 * حقل الإدخال نفسه يفضل فوري (يعرض كل حرف لحظيًا)، التأخير في *متى نستخدم القيمة* بس (مثلاً
 * بعت طلب بحث للباك-إند) — مش في الكتابة نفسها.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
