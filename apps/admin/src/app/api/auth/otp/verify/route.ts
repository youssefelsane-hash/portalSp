import { NextRequest, NextResponse } from 'next/server';
import type { ApiEnvelope, LoginResult } from '@baytak/shared-types';
import { isMfaRequiredResponse } from '@baytak/shared-types';
import { backendUrl, REFRESH_TOKEN_COOKIE } from '@/lib/backend';

// تسجيل الدخول: الـ refresh_token بيتحط httpOnly (مايوصلش لجافاسكريبت العميل خالص، أهم دفاع
// ضد سرقة الـ token عبر XSS) — الـ access_token بس (قصير العمر، 15 دقيقة) بيرجع في الـ body
// عشان الـ client يحطه في الذاكرة ويستخدمه في نداءات الـ API مباشرة.
//
// حساب High-Privilege (ADR-0011) بيرجّع mfa_required بدل TokenPair — مفيش كوكي يتحط هنا خالص،
// تسجيل الدخول لسه مش مكتمل لحد ما ceremony الـPasskey (registration/authentication) تخلص عبر
// /api/auth/webauthn/*/verify.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/otp/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ApiEnvelope<LoginResult>;

  if (!res.ok || !data.data) {
    return NextResponse.json(data, { status: res.status });
  }

  if (isMfaRequiredResponse(data.data)) {
    return NextResponse.json({
      success: true,
      data: data.data,
      meta: null,
      error: null,
      request_id: data.request_id,
    });
  }

  const response = NextResponse.json({
    success: true,
    data: { access_token: data.data.access_token, expires_in_seconds: data.data.expires_in_seconds },
    meta: null,
    error: null,
    request_id: data.request_id,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, data.data.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 يوم — مطابق JWT_REFRESH_EXPIRES_IN الافتراضي في apps/api
  });
  return response;
}
