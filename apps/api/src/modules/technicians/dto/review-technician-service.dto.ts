import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SkillLevel } from '../../catalog/entities/technician-service.entity';

// موافقة الأدمن على تصريح مهارة ذاتي — نفس النمط بالحرف زي ReviewDocumentDto/RejectTechnicianDto.
export class RejectTechnicianServiceDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class ApproveTechnicianServiceDto {
  // الأدمن يقدر يضبط مستوى المهارة النهائي وقت الاعتماد (اقتراح الفني مش ملزم).
  @IsOptional()
  @IsEnum(SkillLevel)
  skill_level?: SkillLevel;
}
