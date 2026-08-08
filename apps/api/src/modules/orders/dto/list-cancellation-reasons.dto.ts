import { IsEnum, IsOptional } from 'class-validator';
import { CancellationAppliesTo } from '../entities/cancellation-reason.entity';

export class ListCancellationReasonsDto {
  @IsOptional()
  @IsEnum(CancellationAppliesTo)
  applies_to?: CancellationAppliesTo;
}
