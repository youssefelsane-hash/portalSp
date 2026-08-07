import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { SkillLevel } from '../entities/technician-service.entity';

export class AssignTechnicianServiceDto {
  @IsUUID()
  technician_id: string;

  @IsOptional()
  @IsEnum(SkillLevel)
  skill_level?: SkillLevel;
}
