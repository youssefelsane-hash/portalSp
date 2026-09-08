import { IsIn, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** قرار بشري موثق فقط بعد التحقق من لوحة/مرجع مزود الدفع. */
export class ReconcileRefundDto {
  @IsIn(['confirmed', 'rejected'])
  outcome: 'confirmed' | 'rejected';

  @ValidateIf((value: ReconcileRefundDto) => value.outcome === 'confirmed')
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  provider_refund_id?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  evidence: string;
}
