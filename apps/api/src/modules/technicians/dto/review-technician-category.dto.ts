import { IsString, MaxLength, MinLength } from 'class-validator';

// موافقة/رفض/إيقاف الأدمن على تصريح فئة ذاتي — نفس نمط review-technician-service.dto.ts بالحرف.
// الموافقة نفسها بلا body (مفيش skill_level على مستوى فئة كاملة تحتاج تعديل وقت الاعتماد).
export class RejectTechnicianCategoryDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
