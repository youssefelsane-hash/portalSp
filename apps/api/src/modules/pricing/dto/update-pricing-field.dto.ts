import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePricingFieldDto } from './create-pricing-field.dto';

export class UpdatePricingFieldDto extends PartialType(CreatePricingFieldDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
