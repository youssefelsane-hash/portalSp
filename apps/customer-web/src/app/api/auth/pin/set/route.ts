import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

/**
 * **تعيين/تغيير رمز الدخول لمستخدم متوثّق** (ADR-0109 §6-أ).
 *
 * الـ`access_token` بييجي من الصفحة في هيدر `Authorization` وبيتعدّي زي ما هو — المسار ده
 * **مابيلمسش الكوكي خالص**: تغيير الرمز مش تسجيل دخول، فالجلسة الحالية بتفضل زي ما هي.
 *
 * التمرير بيتم **بلا** قراءة أو تعديل للتوكن هنا: أي معالجة زيادة على credential في طبقة وسيطة
 * هي سطح هجوم جديد بلا أي مقابل.
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
