import { IsBoolean, IsOptional } from 'class-validator';

// إيقاف/استئناف مؤقت بس (is_active) — تعديل الخدمة/العنوان/التردد مش مدعوم عمداً، أبسط وأوضح
// للعميل إنه يلغي القالب القديم وينشئ واحد جديد بدل تعديل جزئي محيّر لتاريخ next_run_at.
export class UpdateRecurringTemplateDto {
  @IsBoolean()
  is_active: boolean;
}
