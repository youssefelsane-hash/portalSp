import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateServiceZoneDto } from './create-service-zone.dto';

export class UpdateServiceZoneDto extends PartialType(CreateServiceZoneDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
