import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class AssignTechnicianZoneDto {
  @IsUUID()
  service_zone_id: string;

  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;
}
