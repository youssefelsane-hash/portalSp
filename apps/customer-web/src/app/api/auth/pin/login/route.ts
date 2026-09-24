import { NextRequest, NextResponse } from 'next/server';
import { ApiEnvelope, TokenPair } from '@/lib/api-types';
import { backendUrl, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS } from '@/lib/backend';

/**
 * **الدخول برقم + رمز** (ADR-0109) — بديل `otp/verify`.
 *
 * نفس معالجة التوكنز بالحرف: `refresh_token` بيتحوّل لكوكي `httpOnly` مايوصلش لجافاسكريبت
 * المتصفح خالص، و`access_token` بس بيرجع في الـbody ويعيش في ذاكرة الصفحة.
 *
 * العميل معندوش WebAuthn/MFA خالص (ADR-0011 — High-Privilege للأدمن بس)، فمفيش فرع
 * `mfa_required` هنا. لو اتغيّر ده في المستقبل، الفرع لازم يتضاف زي ما هو في لوحة الأدمن.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/pin/login'), {
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
