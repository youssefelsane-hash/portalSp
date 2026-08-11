import { IsInt, IsNumber, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';

export class EstimateDurationDto {
  @IsUUID()
  standard_data_id: string;

  @IsNumber()
  @IsPositive()
  requested_units: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  assigned_technicians?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  assigned_assistants?: number;
}
