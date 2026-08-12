import { IsDateString, IsOptional } from 'class-validator';

export class ScheduleQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
