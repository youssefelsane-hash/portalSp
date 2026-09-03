'use client';

import { useEffect, useRef } from 'react';

/**
 * مبلغ بيتغيّر وقت ما العميل يعدّل اختياراته — بيومض ومضة واحدة خفيفة عند التغيير (docs/08 §122).
 *
 * ده أهم مكان في فلو الحجز كله يستاهل حركة: العميل بيغيّر خيار في الفورم، والسعر فوق بيتبدّل
 * **في صمت**. لو بصّته مكانتش على الرقم في اللحظة دي، مايعرفش إن اختياره غيّر السعر أصلاً —
 * وده بالظبط النوع من المفاجآت اللي بتخلّي العميل يقف عند خطوة التأكيد.
 *
 * ومضة، مش عدّاد بيلف: الرقم لازم يفضل **مقروء** طول الوقت، والعدّاد الدوّار بيمنع ده في
 * اللحظة اللي العميل عايز يقرا فيها بالظبط.
 *
 * الحركة إجبارية على الـDOM مش عبر `state` عشان تحديث السعر ما يجرّش re-render زيادة لشجرة
 * صفحة الحجز كلها (فيها فورم ديناميكي وخريطة).
 */
export function LiveAmount({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;

    const el = ref.current;
    if (!el) return;
    // إعادة تشغيل حركة CSS: شيل + reflow إجباري + رجوع. من غير الـreflow المتصفح بيدمج
    // التغييرين في نفس الإطار فمابيحصلش إعادة تشغيل.
    el.classList.remove('motion-value-change');
    void el.offsetWidth;
    el.classList.add('motion-value-change');
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {value}
    </span>
  );
}
