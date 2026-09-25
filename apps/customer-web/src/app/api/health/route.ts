import { NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend';

/**
 * **uptime الموقع العام** (ADR-0114 §5) — نقطة المراقبة الخارجية لطبقة الويب.
 *
 * ليه مش كفاية إن المراقبة تفتح الصفحة الرئيسية: صفحة Next ممكن ترجع ٢٠٠ من الكاش وهي **مش
 * شايفة الباك-إند خالص**. «الموقع شغّال» كده بيبقى جواب كاذب بالظبط في اللحظة اللي محتاجين فيها
 * الجواب الصح. المسار ده بيتأكد إن الطبقة دي قادرة **توصل للـAPI** فعلاً.
 *
 * `degraded` مش `down` لما الـAPI ما يردّش: الويب نفسه شغّال وبيخدم صفحات عامة، والتفرقة دي هي
 * اللي بتخلي الإنذار يقول «الباك-إند» مش «الموقع».
 */
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 4_000;

export async function GET() {
  const startedAt = Date.now();
  try {
    // `/branding` عام وخفيف وبيلمس الإعدادات — يعني رد ٢٠٠ منه معناه إن الـAPI **وقاعدته**
    // شغالين، مش بس إن الـprocess رد.
    const res = await fetch(backendUrl('/branding'), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const apiLatencyMs = Date.now() - startedAt;
    const ok = res.ok;
    return NextResponse.json(
      {
        status: ok ? 'ok' : 'degraded',
        web: 'ok',
        api: ok ? 'ok' : `http_${res.status}`,
        api_latency_ms: apiLatencyMs,
        checked_at: new Date().toISOString(),
      },
      // **٥٠٣ مش ٢٠٠** لما الاعتماد واقع: أغلب أدوات المراقبة بتنذر على كود الحالة، وردّ ٢٠٠
      // بجسم بيقول "degraded" بيعدّي من غير ما يوقّظ حد.
      { status: ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json(
      {
        status: 'degraded',
        web: 'ok',
        api: 'unreachable',
        api_latency_ms: Date.now() - startedAt,
        checked_at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
