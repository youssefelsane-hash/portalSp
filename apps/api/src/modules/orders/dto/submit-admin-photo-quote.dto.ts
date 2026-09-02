import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SubmitAdminPhotoQuoteDto {
  @IsInt()
  @Min(1)
  quoted_amount_cents: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  scope_included?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  scope_excluded?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(43_200)
  estimated_duration_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  required_technicians?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  required_assistants?: number;
}
