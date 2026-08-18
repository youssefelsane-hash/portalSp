import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SecurityEventStatus } from '../entities/security-event.entity';

export class ResolveSecurityEventDto {
  @IsIn([SecurityEventStatus.RESOLVED, SecurityEventStatus.FALSE_POSITIVE])
  status: SecurityEventStatus.RESOLVED | SecurityEventStatus.FALSE_POSITIVE;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolution_note?: string;
}
