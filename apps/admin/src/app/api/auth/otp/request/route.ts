import { NextRequest, NextResponse } from 'next/server';
import type { ApiEnvelope } from '@baytak/shared-types';
import { backendUrl } from '@/lib/backend';

// بروكسي بسيط لطلب OTP — مفيش حاجة حساسة هنا (مفيش tokens)، بس بيوحّد المصدر اللي الـ client
// بيكلمه (نفس الأصل، مفيش CORS) ويطابق نمط باقي مسارات /api/auth هنا.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/otp/request'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as ApiEnvelope<unknown>;
  return NextResponse.json(data, { status: res.status });
}
