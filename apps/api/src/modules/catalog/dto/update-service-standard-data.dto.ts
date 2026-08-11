import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateServiceStandardDataDto } from './create-service-standard-data.dto';

export class UpdateServiceStandardDataDto extends PartialType(CreateServiceStandardDataDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
