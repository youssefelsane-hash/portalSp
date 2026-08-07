import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entity_type?: string;

  @IsOptional()
  @IsUUID()
  entity_id?: string;

  @IsOptional()
  @IsUUID()
  actor_user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page?: number = 20;
}
