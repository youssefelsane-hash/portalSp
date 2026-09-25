import type { Metadata } from 'next';
import { ServiceSeoPage, buildServiceSeoMetadata } from '@/components/seo/service-seo-page';
import { BookingFlow } from './booking-flow';

/**
 * **مسار واحد، صفحتين** (ADR-0113).
 *
 * `/services/{uuid}` = فلو الحجز (كان `[id]`)، و`/services/{slug}` = صفحة الظهور في البحث.
 * الدمج **إجباري** مش تفضيل: Next بيرفض قطعتين ديناميكيتين في نفس المستوى، والتفريق بالشكل
 * بيخلّي كل الروابط القديمة بـUUID شغّالة زي ما هي.
 */

/** `services.id` جاي من `uuid_generate_v7()` — الشكل ثابت ومافيهوش لبس مع أي سلَج. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceSlug: string }>;
}): Promise<Metadata> {
  const { serviceSlug } = await params;
  // **فلو الحجز مش بيتفهرس**: صفحة تفاعلية محتاجة اختيارات العميل، وفهرستها معناها نتيجة بحث
  // بتوصّل لنموذج نصف فاضي بدل صفحة بتشرح الخدمة.
  if (UUID_PATTERN.test(serviceSlug)) return { robots: { index: false, follow: false } };
  return buildServiceSeoMetadata(serviceSlug);
}

export default async function Page({ params }: { params: Promise<{ serviceSlug: string }> }) {
  const { serviceSlug } = await params;
  if (UUID_PATTERN.test(serviceSlug)) return <BookingFlow serviceId={serviceSlug} />;
  return <ServiceSeoPage slug={serviceSlug} />;
}
