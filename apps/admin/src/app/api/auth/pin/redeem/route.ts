import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

/**
 * **استهلاك كود التنشيط/الاسترجاع** (ADR-0111) — تمرير مباشر بلا أي منطق كوكي.
 *
 * ده الجزء اللي كان **ناقص**: الباك-إند عامل `POST /auth/pin/reset/redeem` صح، والموظف الجديد
 * بياخد كود تنشيط من الـSuper Admin، بس **مكانش فيه أي مكان في لوحة التحكم يستهلكه فيه**.
 * والنتيجة إن الموظف كان لازم يروح **موقع العملاء** يفعّل حساب إداري — مسار شغّال تقنيًا بس
 * غلط تمامًا: موظف Osta مالوش دعوة بموقع العملاء عشان يفعّل حسابه.
 *
 * **مفيش `Authorization` هنا عن قصد**: الموظف لسه مالوش جلسة — ده بالظبط سبب وجود المسار. الأمان
 * في الكود نفسه: ١٠ أرقام، ١٥ دقيقة، لمرة واحدة، bcrypt، وعدّاد محاولات على السيرفر.
 *
 * **ومابيرجّعش جلسة**: الكود تصريح لتعيين رمز مش تسجيل دخول. الموظف بيدخل بالرمز الجديد من شاشة
 * الدخول العادية، فمسار الدخول يفضل واحد لكل الحالات — وبالتالي سياسة MFA/Passkey (ADR-0011)
 * بتتفرض عليه زي أي حد تاني بلا أي استثناء.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/pin/reset/redeem'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
