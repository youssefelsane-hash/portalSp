import { IsDefined, IsEnum, IsIn, IsUUID } from 'class-validator';

export enum ZoneCatalogTargetType {
  CATEGORY = 'category',
  SERVICE = 'service',
}

export class SetZoneCatalogAvailabilityDto {
  @IsEnum(ZoneCatalogTargetType)
  target_type: ZoneCatalogTargetType;

  @IsUUID()
  target_id: string;

  /** null removes the explicit rule and restores inheritance/default-enabled behaviour. */
  @IsDefined()
  @IsIn([true, false, null])
  is_enabled: boolean | null;
}
