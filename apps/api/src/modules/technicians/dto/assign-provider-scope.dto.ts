import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** ADR-0079 — نفس شكل مدخلات نطاق الفني بالحرف، بس على مالك متغيّر. */
export class AssignProviderServiceDto {
  @IsUUID()
  service_id: string;
}

export class AssignProviderCategoryDto {
  @IsUUID()
  category_id: string;
}

export class AssignProviderZoneDto {
  @IsUUID()
  service_zone_id: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}
