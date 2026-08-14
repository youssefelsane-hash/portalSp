import { IsEnum } from 'class-validator';
import { BrandingAssetType } from '../entities/branding-asset.entity';

export class BrandingAssetTypeParamDto {
  @IsEnum(BrandingAssetType)
  assetType: BrandingAssetType;
}
