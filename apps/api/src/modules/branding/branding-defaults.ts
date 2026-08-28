import { BrandingAssetType } from './entities/branding-asset.entity';

/**
 * Fallback مضمّن في الكود نفسه — SVG بسيط جدًا (اسم النص بخط عادي)، **مش** أصل براندنج نهائي.
 * الهدف الوحيد: `GET /branding` أبدًا ميرجعش فاضي/null حتى لو مفيش حد رفع حاجة لسه أو التخزين واقع
 * بالكامل (ADR-0014). بمجرد ما Super Admin يرفع الملف الحقيقي عبر لوحة الأدمن، ده بيحل محله فورًا.
 * data: URI عشان ميحتاجش أي طلب شبكة/تخزين إضافي — أبسط "دايمًا متاح" ممكن.
 */
function placeholderSvgDataUri(label: string, bg: string, fg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><rect width="240" height="80" rx="8" fill="${bg}"/><text x="120" y="46" font-family="sans-serif" font-size="28" font-weight="600" fill="${fg}" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export interface DefaultBrandingAsset {
  url: string;
  width_px: number;
  height_px: number;
}

export const DEFAULT_BRANDING_ASSETS: Record<BrandingAssetType, DefaultBrandingAsset> = {
  [BrandingAssetType.PRIMARY_LOGO]: { url: placeholderSvgDataUri('OSTA', '#0F172A', '#FFFFFF'), width_px: 240, height_px: 80 },
  [BrandingAssetType.SPLASH]: { url: placeholderSvgDataUri('OSTA', '#0F172A', '#FFFFFF'), width_px: 240, height_px: 80 },
};
