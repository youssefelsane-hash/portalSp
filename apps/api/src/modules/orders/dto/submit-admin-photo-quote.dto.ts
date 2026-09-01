import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SubmitAdminPhotoQuoteDto {
  @IsInt()
  @Min(1)
  quoted_amount_cents: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
