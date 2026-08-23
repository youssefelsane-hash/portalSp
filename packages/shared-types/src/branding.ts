// مطابق لـ apps/api/src/modules/branding (ADR-0014)
export type BrandingAssetType = 'primary_logo' | 'logo_mark' | 'logo_light' | 'logo_dark' | 'login_logo' | 'splash';

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

export const BRANDING_ASSET_TYPES: BrandingAssetType[] = [
  'primary_logo',
  'logo_mark',
  'logo_light',
  'logo_dark',
  'login_logo',
  'splash',
];

export const BRANDING_ASSET_LABELS_AR: Record<BrandingAssetType, string> = {
  primary_logo: 'اللوجو الأساسي',
  logo_mark: 'الرمز المختصر',
  logo_light: 'نسخة فاتحة',
  logo_dark: 'نسخة غامقة',
  login_logo: 'لوجو شاشة الدخول',
  // بلاغ مالك صريح 2026-08-23: كان اسمها "شاشة البداية (Splash)" — عمل تحمل ديه توهم إنها
  // خلفية الـsplash التقنية بس، بينما هي فعليًا الصورة اللي وراء صندوق البحث في الشاشة الرئيسية
  // (أول ما تفتح التطبيق). نفس asset_type='splash' في الـDB/الـAPI زي ما هو (مفيش migration)،
  // الاسم المعروض بس اتوضّح. راجع apps/customer-web/src/app/page.tsx و
  // apps/customer-app/lib/features/catalog/home_screen.dart للاستهلاك الفعلي.
  splash: 'خلفية الشاشة الرئيسية (وراء صندوق البحث)',
};
