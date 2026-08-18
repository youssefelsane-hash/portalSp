import { NextRequest, NextResponse } from 'next/server';
import { ApiEnvelope, TokenPair } from '@/lib/api-types';
import { backendUrl, REFRESH_TOKEN_COOKIE } from '@/lib/backend';

// بيتنادى من الـ client لما access_token ينتهي — بياخد refresh_token من httpOnly cookie (مش من
// body، الـ client أصلاً معندوش وصول ليه)، ويرجّع access_token جديد + يحدّث الكوكي (الباك-إند
// بيدوّر الـrefresh token على كل استخدام، P0-5).
export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      { success: false, data: null, meta: null, error: { code: 'AUTH_NO_SESSION', message: 'مفيش جلسة' }, request_id: '' },
      { status: 401 },
    );
  }

  const res = await fetch(backendUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = (await res.json()) as ApiEnvelope<TokenPair>;

  if (!res.ok || !data.data) {
    const response = NextResponse.json(data, { status: res.status });
    response.cookies.delete(REFRESH_TOKEN_COOKIE);
    return response;
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
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
