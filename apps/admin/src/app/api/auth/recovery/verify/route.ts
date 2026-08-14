import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

// استرجاع MFA (ADR-0011 §6) — مفيش TokenPair هنا خالص، الرد دايمًا mfa_required+ceremony=registration
// (نفس شكل /auth/otp/verify العادي)، فمفيش داعي لمنطق كوكي هنا، تمرير مباشر بس.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(backendUrl('/auth/recovery/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
