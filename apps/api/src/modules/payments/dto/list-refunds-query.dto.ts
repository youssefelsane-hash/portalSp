import { IsEnum, IsOptional } from 'class-validator';
import { RefundStatus } from '../entities/refund.entity';

export class ListRefundsQueryDto {
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;
}
