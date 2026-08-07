import { IsString, Length } from 'class-validator';

export class RejectPayoutDto {
  @IsString()
  @Length(2, 500)
  reason: string;
}
