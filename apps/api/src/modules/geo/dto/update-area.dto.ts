import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateAreaDto } from './create-area.dto';

export class UpdateAreaDto extends PartialType(CreateAreaDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_launched?: boolean;
}
