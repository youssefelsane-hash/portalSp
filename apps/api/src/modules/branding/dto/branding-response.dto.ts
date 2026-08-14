import { BrandingAsset, BrandingAssetType } from '../entities/branding-asset.entity';

export interface BrandingAssetResponseDto {
  asset_type: BrandingAssetType;
  url: string;
  width_px: number;
  height_px: number;
  is_default: boolean;
}

// نسخة الأدمن بس فيها معلومات إضافية (مين رفع، امتى) — مش لازمة للاستهلاك العام (`GET /branding`).
export interface AdminBrandingAssetResponseDto extends BrandingAssetResponseDto {
  mime_type: string | null;
  file_size_bytes: number | null;
  original_file_name: string | null;
  uploaded_by_user_id: string | null;
  updated_at: string | null;
}

export type BrandingPayloadDto = Record<BrandingAssetType, BrandingAssetResponseDto>;
export type AdminBrandingPayloadDto = Record<BrandingAssetType, AdminBrandingAssetResponseDto>;

export function toAdminBrandingAssetResponseDto(
  assetType: BrandingAssetType,
  asset: BrandingAsset | null,
  url: string,
  fallbackWidth: number,
  fallbackHeight: number,
): AdminBrandingAssetResponseDto {
  if (!asset) {
    return {
      asset_type: assetType,
      url,
      width_px: fallbackWidth,
      height_px: fallbackHeight,
      is_default: true,
      mime_type: null,
      file_size_bytes: null,
      original_file_name: null,
      uploaded_by_user_id: null,
      updated_at: null,
    };
  }
  return {
    asset_type: assetType,
    url,
    width_px: asset.widthPx,
    height_px: asset.heightPx,
    is_default: false,
    mime_type: asset.mimeType,
    file_size_bytes: asset.fileSizeBytes,
    original_file_name: asset.originalFileName,
    uploaded_by_user_id: asset.uploadedByUserId,
    updated_at: asset.updatedAt.toISOString(),
  };
}
