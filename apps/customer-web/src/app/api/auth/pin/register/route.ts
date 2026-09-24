import { NextRequest, NextResponse } from 'next/server';
import { ApiEnvelope, TokenPair } from '@/lib/api-types';
import { backendUrl, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS } from '@/lib/backend';

/**
 * **تسجيل حساب جديد برقم + رمز** (ADR-0109) — بديل `register`.
 *
 * نفس معالجة التوكنز بالحرف زي مسار الدخول: `refresh_token` كوكي `httpOnly`، و`access_token`
 * في الـbody بس.
 *
 * كل الأحداث اللي كانت بتحصل بعد التسجيل بتفضل زي ما هي في الباك-إند (الترشيح، الإسناد
 * التسويقي، رابط العرض، إشعار الترحيب) — الحقل الوحيد اللي اتغيّر هو `otp_code` ← `pin`.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/pin/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ApiEnvelope<TokenPair>;

  if (!res.ok || !data.data) {
    return NextResponse.json(data, { status: res.status });
  }

  const response = NextResponse.json({
    success: true,
    data: { access_token: data.data.access_token, expires_in_seconds: data.data.expires_in_seconds },
    meta: null,
    error: null,
    request_id: data.request_id,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, data.data.refresh_token, REFRESH_COOKIE_OPTIONS);
  return response;
}
