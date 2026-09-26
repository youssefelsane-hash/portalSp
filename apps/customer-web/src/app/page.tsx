import type { Metadata } from 'next';
import HomePageClient from './home-page-client';
import { BRAND_ALTERNATE_NAMES, SITE_URL } from '@/lib/seo';

const homeUrl = `${SITE_URL}/`;

export const metadata: Metadata = {
  alternates: { canonical: homeUrl },
};

const siteIdentity = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${homeUrl}#website`,
      name: 'أسطى',
      alternateName: [...BRAND_ALTERNATE_NAMES],
      url: homeUrl,
      publisher: { '@id': `${homeUrl}#organization` },
    },
    {
      '@type': 'Organization',
      '@id': `${homeUrl}#organization`,
      name: 'أسطى',
      alternateName: [...BRAND_ALTERNATE_NAMES],
      url: homeUrl,
      logo: `${SITE_URL}/icon.png`,
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteIdentity) }} />
      <HomePageClient />
    </>
  );
}
