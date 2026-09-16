// مطابق لـ apps/api/src/modules/branding (ADR-0014)
// `logo_mark` رجع في ADR-0092 مع مستهلك فعلي في شِل لوحة الإدارة؛ الأنواع الشكلية الأخرى
// (logo_light/logo_dark/login_logo) ما زالت مستبعدة. لازم يفضل مطابقًا لـ
// apps/api/src/modules/branding/entities/branding-asset.entity.ts's BrandingAssetType.
export type BrandingAssetType = 'primary_logo' | 'logo_mark' | 'splash' | 'home_banner';

export interface BrandingAssetResponseDto {
  asset_type: BrandingAssetType;
  url: string;
  width_px: number;
  height_px: number;
  is_default: boolean;
}

export interface AdminBrandingAssetResponseDto extends BrandingAssetResponseDto {
  mime_type: string | null;
  file_size_bytes: number | null;
  original_file_name: string | null;
  uploaded_by_user_id: string | null;
  updated_at: string | null;
}

export type BrandingPayloadDto = Record<BrandingAssetType, BrandingAssetResponseDto>;
export type AdminBrandingPayloadDto = Record<BrandingAssetType, AdminBrandingAssetResponseDto>;

export const BRANDING_ASSET_TYPES: BrandingAssetType[] = ['primary_logo', 'logo_mark', 'splash', 'home_banner'];

export const BRANDING_ASSET_LABELS_AR: Record<BrandingAssetType, string> = {
  // اللوجو الوحيد في المنصة: رأس الشاشة الرئيسية + شاشة الدخول في تطبيق العميل.
  primary_logo: 'لوجو الشركة (الرأس + شاشة الدخول)',
  logo_mark: 'الرمز المختصر (القائمة + المساحات الصغيرة)',
  // بلاغ مالك صريح 2026-08-23: كان اسمها "شاشة البداية (Splash)" — عمل تحمل ديه توهم إنها
  // خلفية الـsplash التقنية بس، بينما هي فعليًا الصورة اللي وراء صندوق البحث في الشاشة الرئيسية
  // (أول ما تفتح التطبيق). نفس asset_type='splash' في الـDB/الـAPI زي ما هو (مفيش migration)،
  // الاسم المعروض بس اتوضّح. راجع apps/customer-web/src/app/page.tsx و
  // apps/customer-app/lib/features/catalog/home_screen.dart للاستهلاك الفعلي.
  splash: 'خلفية الشاشة الرئيسية (وراء صندوق البحث)',
  // ADR-0095 — بانر مستطيل مستقل تمامًا عن خلفية الـhero: ده صورة إعلانية جوّه محتوى الشاشة،
  // مش خلفية وراء نص. بيختفي بالكامل طالما الأدمن مارفعش صورة (`is_default = true`).
  home_banner: 'بانر الشاشة الرئيسية (صورة مستطيلة داخل الصفحة)',
};
