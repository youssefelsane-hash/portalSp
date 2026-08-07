import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAvailabilityDto {
  @IsOptional()
  @IsBoolean()
  is_available?: boolean;

  @IsOptional()
  @IsBoolean()
  is_on_duty?: boolean;
}
