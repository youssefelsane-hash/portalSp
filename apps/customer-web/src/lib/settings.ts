import { apiFetch } from './api-client';
import { BrandingAssetDto, HomepageContentDto, SupportContactDto } from './api-types';

// إعدادات عامة مُدارة من الأدمن — مفيش access_token مطلوب (Public() في الباك-إند)، نفس نمط catalog.ts.
export const fetchHomepageContent = () => apiFetch<HomepageContentDto>('/settings/homepage-content', null);

export const fetchSupportContact = () => apiFetch<SupportContactDto>('/settings/support-contact', null);

// GET /branding — @Public()، بيرجّع fallback (data URI افتراضي، is_default=true) دايمًا لو مفيش
// حاجة مرفوعة. بيانات كل أصل من BrandingPayloadDto — هنا محتاجين splash بس (خلفية الشاشة الرئيسية).
export const fetchHeroBackground = async (): Promise<BrandingAssetDto> => {
  const payload = await apiFetch<Record<string, BrandingAssetDto>>('/branding', null);
  return payload.splash;
};

// بَقّة حقيقية اتلقطت (بلاغ مالك بلقطة شاشة، docs/08 §84 جزء أ) — customer-web كان التطبيق
// الوحيد اللي مبيعرضش لوجو حقيقي خالص (site-header.tsx كان نص "صُنّاع" مباشرة، صفر استدعاء
// لـGET /branding) بعكس customer-app اللي بيجيب ويعرض primary_logo فعليًا (branding_repository.dart).
export const fetchLogo = async (): Promise<BrandingAssetDto> => {
  const payload = await apiFetch<Record<string, BrandingAssetDto>>('/branding', null);
  return payload.primary_logo;
};
