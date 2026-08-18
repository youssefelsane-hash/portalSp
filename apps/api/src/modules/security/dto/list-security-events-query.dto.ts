import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { SecurityEventSeverity, SecurityEventStatus, SecurityEventType } from '../entities/security-event.entity';

export class ListSecurityEventsQueryDto {
  @IsOptional()
  @IsEnum(SecurityEventSeverity)
  severity?: SecurityEventSeverity;

  @IsOptional()
  @IsEnum(SecurityEventStatus)
  status?: SecurityEventStatus;

  @IsOptional()
  @IsUUID()
  actor_user_id?: string;

  @IsOptional()
  @IsEnum(SecurityEventType)
  event_type?: SecurityEventType;

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
