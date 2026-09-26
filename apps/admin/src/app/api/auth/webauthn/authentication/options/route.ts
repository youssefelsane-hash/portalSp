import { NextRequest, NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

export async function POST(req: NextRequest) {
  const res = await fetch(backendUrl('/auth/webauthn/authentication/options'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await req.json()),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
