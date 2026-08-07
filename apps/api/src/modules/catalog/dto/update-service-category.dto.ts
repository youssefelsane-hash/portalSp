import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsBoolean } from 'class-validator';
import { CreateServiceCategoryDto } from './create-service-category.dto';

export class UpdateServiceCategoryDto extends PartialType(CreateServiceCategoryDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
