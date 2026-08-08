import { IsEnum, IsOptional } from 'class-validator';
import { PayoutStatus } from '../entities/payout.entity';

export class ListPayoutsQueryDto {
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;
}
