import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PayoutMethod } from '../entities/payout.entity';

export class RequestPayoutDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_00) // مليون جنيه — سقف دفاعي، مش رقم عمل حقيقي
  amount_cents: number;

  @IsEnum(PayoutMethod)
  payout_method: PayoutMethod;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  destination_masked?: string;
}
