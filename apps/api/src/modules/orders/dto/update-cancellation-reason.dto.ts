import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateCancellationReasonDto } from './create-cancellation-reason.dto';

export class UpdateCancellationReasonDto extends PartialType(CreateCancellationReasonDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
