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
