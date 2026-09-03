'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * رقم بيتحدّث لحظيًا — بيومض ومضة واحدة خفيفة لما قيمته تتغيّر (docs/08 §122).
 *
 * المشكلة اللي بيحلّها: الأدمن سايب لوحة التحكم مفتوحة، و`useAdminLiveRefresh` بيجيب بيانات
 * جديدة كل شوية. الأرقام كانت بتتبدّل **في صمت تام** — الموظف يبص على شاشة فيها ١٢ عدّاد
 * ومايعرفش أنهي واحد اتغيّر، ولا إن في حاجة اتغيّرت أصلاً.
 *
 * ليه ومضة مش عدّاد بيلف من رقم لرقم: العدّاد الدوّار بيخلي الرقم **مقروء بصعوبة** في اللحظة
 * اللي المستخدم عايز يقراه فيها بالظبط، وبيتكلّف re-render لكل إطار. الومضة بتوصل نفس
 * المعلومة («ده اتغيّر») في 260ms وبتسيب الرقم واضح طول الوقت.
 *
 * التنفيذ إجباري DOM بدل `state`: لو الحركة اتعملت بـ`useState` كان كل تحديث هيعمل
 * re-render زيادة للشجرة كلها عشان class بيتشال بعد ربع ثانية. هنا الـeffect بيلمس عنصر واحد.
 */
export function LiveValue({ value, className }: { value: string | number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    // أول رندر مابيومضش: الرقم بيظهر لأول مرة، مش بيتغيّر.
    if (previous.current === value) return;
    previous.current = value;

    const el = ref.current;
    if (!el) return;
    // إعادة تشغيل حركة CSS محتاجة شيل الكلاس + reflow إجباري + رجوعه. من غير الـreflow
    // المتصفح بيدمج التغييرين في نفس الإطار فمابيحصلش إعادة تشغيل أصلاً.
    el.classList.remove('motion-value-change');
    void el.offsetWidth;
    el.classList.add('motion-value-change');
  }, [value]);

  return (
    <span ref={ref} className={cn('inline-block tabular-nums', className)}>
      {value}
    </span>
  );
}
