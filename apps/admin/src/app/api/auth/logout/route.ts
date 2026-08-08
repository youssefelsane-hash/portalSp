import { NextRequest, NextResponse } from 'next/server';
import { backendUrl, REFRESH_TOKEN_COOKIE } from '@/lib/backend';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (refreshToken) {
    await fetch(backendUrl('/auth/logout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).catch(() => null); // لو الباك-إند مش متاح، امسح الكوكي المحلي برضه وسيب المستخدم يخرج
  }

  const response = NextResponse.json({ success: true, data: null, meta: null, error: null, request_id: '' });
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
  return response;
}
