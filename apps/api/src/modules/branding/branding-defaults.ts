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

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const MARK_PATH =
  'M 50 4 A 46 46 0 1 1 49.99 4 Z M 76.5 55.196 Q 79.5 50 76.5 44.804 L 67.75 29.648 Q 64.75 24.452 58.75 24.452 L 41.25 24.452 Q 35.25 24.452 32.25 29.648 L 23.5 44.804 Q 20.5 50 23.5 55.196 L 32.25 70.352 Q 35.25 75.548 41.25 75.548 L 58.75 75.548 Q 64.75 75.548 67.75 70.352 Z';

const DEFAULT_MARK = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${MARK_PATH}" fill="#123b69" fill-rule="evenodd"/></svg>`,
);

const DEFAULT_LOGO = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80" viewBox="0 0 280 80"><g transform="translate(6 2) scale(.76)"><path d="${MARK_PATH}" fill="#123b69" fill-rule="evenodd"/></g><text x="92" y="57" font-family="Avenir Next,Montserrat,sans-serif" font-size="52" font-weight="700" letter-spacing="3" fill="#142235">OSTA</text></svg>`,
);

export interface DefaultBrandingAsset {
  url: string;
  width_px: number;
  height_px: number;
}

export const DEFAULT_BRANDING_ASSETS: Record<BrandingAssetType, DefaultBrandingAsset> = {
  [BrandingAssetType.PRIMARY_LOGO]: {
    url: DEFAULT_LOGO,
    width_px: 280,
    height_px: 80,
  },
  [BrandingAssetType.LOGO_MARK]: {
    url: DEFAULT_MARK,
    width_px: 100,
    height_px: 100,
  },
  [BrandingAssetType.SPLASH]: {
    url: placeholderSvgDataUri('OSTA', '#123B69', '#FFF8F2'),
    width_px: 240,
    height_px: 80,
  },
};
