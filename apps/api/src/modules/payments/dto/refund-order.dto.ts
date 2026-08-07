import { IsString, Length } from 'class-validator';

export class RefundOrderDto {
  @IsString()
  @Length(2, 500)
  reason_notes: string;
}
