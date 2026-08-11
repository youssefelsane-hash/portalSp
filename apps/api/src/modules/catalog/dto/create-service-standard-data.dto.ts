import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Length, Min } from 'class-validator';

export class CreateServiceStandardDataDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  execution_type_ar?: string;

  @IsString()
  @Length(1, 20)
  unit_ar: string;

  @IsInt()
  @Min(0)
  technician_daily_wage_cents: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  assistant_daily_wage_cents?: number;

  @IsNumber()
  @IsPositive()
  productivity_per_day: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  min_technicians?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  min_assistants?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}
