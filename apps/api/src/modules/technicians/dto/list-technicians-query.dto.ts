import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { TechnicianLevel, TechnicianVerificationStatus } from '../entities/technician-profile.entity';

export class ListTechniciansQueryDto {
  @IsOptional()
  @IsEnum(TechnicianVerificationStatus)
  verification_status?: TechnicianVerificationStatus;

  @IsOptional()
  @IsEnum(TechnicianLevel)
  level?: TechnicianLevel;

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
