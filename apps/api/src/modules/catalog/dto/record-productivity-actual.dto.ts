import { IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class RecordProductivityActualDto {
  @IsOptional()
  @IsUUID()
  order_id?: string;

  @IsNumber()
  @IsPositive()
  actual_units: number;

  @IsNumber()
  @IsPositive()
  actual_days: number;

  @IsInt()
  @Min(1)
  actual_technicians: number;

  @IsInt()
  @Min(0)
  actual_assistants: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
