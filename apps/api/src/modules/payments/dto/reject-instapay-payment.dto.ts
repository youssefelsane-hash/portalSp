import { IsString, Length } from 'class-validator';

export class RejectInstaPayPaymentDto {
  @IsString()
  @Length(2, 500)
  reason: string;
}
