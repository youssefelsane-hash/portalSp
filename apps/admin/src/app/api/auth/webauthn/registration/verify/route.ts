import { NextRequest, NextResponse } from 'next/server';
import type { ApiEnvelope, TokenPair } from '@baytak/shared-types';
import { backendUrl, REFRESH_TOKEN_COOKIE } from '@/lib/backend';

// نفس فلسفة /api/auth/otp/verify بالحرف — بس هنا نهاية مسار تسجيل Passkey جديد جوّه MFA
// (ADR-0011). الرد فيه recovery_codes كمان (أول مرة بس، مبتترجعش تاني بعد كده).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/webauthn/registration/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ApiEnvelope<TokenPair & { recovery_codes: string[] | null }>;

  if (!res.ok || !data.data) {
    return NextResponse.json(data, { status: res.status });
  }

  const response = NextResponse.json({
    success: true,
    data: {
      access_token: data.data.access_token,
      expires_in_seconds: data.data.expires_in_seconds,
      recovery_codes: data.data.recovery_codes,
    },
    meta: null,
    error: null,
    request_id: data.request_id,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, data.data.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
