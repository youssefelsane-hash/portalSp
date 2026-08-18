import { NextRequest, NextResponse } from 'next/server';
import { ApiEnvelope, TokenPair } from '@/lib/api-types';
import { backendUrl, REFRESH_TOKEN_COOKIE } from '@/lib/backend';

// نفس نمط apps/admin's otp/verify route بالحرف (مُراجَع أمنيًا Script 2 task #41) —
// refresh_token httpOnly (مايوصلش لجافاسكريبت العميل خالص)، access_token بس بيرجع في الـ body.
// العميل (customer) معندوش WebAuthn/MFA خالص (ADR-0011 High-Privilege admin بس)، فمفيش فرع mfa_required.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/otp/verify'), {
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
  response.cookies.set(REFRESH_TOKEN_COOKIE, data.data.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // مطابق JWT_REFRESH_EXPIRES_IN الافتراضي في apps/api
  });
  return response;
}
