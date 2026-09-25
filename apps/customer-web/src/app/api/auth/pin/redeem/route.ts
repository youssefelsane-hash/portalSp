import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

/**
 * **استهلاك كود استرجاع رمز الدخول** (ADR-0109 §6-ب) — تمرير مباشر بلا أي منطق كوكي.
 *
 * مقصود إنه **مابيرجّعش جلسة**: الكود تصريح لتعيين رمز مش تسجيل دخول، والعميل بيدخل بالرمز
 * الجديد من شاشة الدخول العادية. كده مسار الدخول واحد لكل الحالات، والكود مالوش أي قيمة لوحده.
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
