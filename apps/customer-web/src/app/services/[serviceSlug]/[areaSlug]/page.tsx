import type { Metadata } from 'next';
import { ServiceSeoPage, buildServiceSeoMetadata } from '@/components/seo/service-seo-page';

/** الخدمة × المنطقة (ADR-0113) — نفس الصفحة المشتركة، بمنطقة. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceSlug: string; areaSlug: string }>;
}): Promise<Metadata> {
  const { serviceSlug, areaSlug } = await params;
  return buildServiceSeoMetadata(serviceSlug, areaSlug);
}

export default async function Page({
  params,
}: {
  params: Promise<{ serviceSlug: string; areaSlug: string }>;
}) {
  const { serviceSlug, areaSlug } = await params;
  return <ServiceSeoPage slug={serviceSlug} areaSlug={areaSlug} />;
}
