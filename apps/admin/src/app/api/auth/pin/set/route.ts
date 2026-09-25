import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

/**
 * **تعيين/تغيير رمز الدخول لأدمن متوثّق** (ADR-0109 §6-أ).
 *
 * بيمرّر الـ`Authorization` زي ما هو **بلا أي قراءة أو تعديل**، ومابيلمسش الكوكي: تغيير الرمز
 * مش تسجيل دخول، فالجلسة الحالية بتفضل زي ما هي والـPasskey مالوش أي علاقة بالعملية دي.
 */
export async function POST(req: NextRequest) {
  const authorization = req.headers.get('authorization');
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/pin'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
