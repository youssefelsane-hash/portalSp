import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TechnicianWageTier } from '../entities/technician-service.entity';

export class AssignTechnicianServiceDto {
  @IsUUID()
  technician_id: string;

  @IsOptional()
  // اسم الحقل على السلك زي ما هو؛ النوع جوّه اتسمّى صح (docs/08 §172).
  @IsEnum(TechnicianWageTier)
  skill_level?: TechnicianWageTier;
}
