import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { SkillLevel } from '../../catalog/entities/technician-service.entity';

// Script 4 §2-7 — الفني بيختار خدمة من الكتالوج الديناميكي الموجود بالفعل (GET /service-categories
// وGET /services?category_id=)، مش بيكتب اسمها بنفسه. skill_level اقتراح الفني بس — الأدمن هو اللي
// بيقرّر النهائي وقت الاعتماد (نفس الحقل، القيمة ممكن تتغيّر وقت approve()).
export class SelfDeclareServiceDto {
  @IsUUID()
  service_id: string;

  @IsOptional()
  @IsEnum(SkillLevel)
  skill_level?: SkillLevel;
}
