import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

// Pass-through بسيط — مفيش توكن هنا خالص، بس عبور عشان الباك-إند الحقيقي مايتعرضش مباشرة للمتصفح.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/otp/request'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
