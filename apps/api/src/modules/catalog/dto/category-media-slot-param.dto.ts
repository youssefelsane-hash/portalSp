import { IsIn, IsUUID } from 'class-validator';

/**
 * خانة صورة الفئة (docs/08 §98) — `icon` أيقونة صغيرة جنب الاسم، `cover` صورة الكارت الكبيرة.
 * الرابط القديم محفوظ للتوافق، والمفتاح الدائم المقابل (`*_storage_key`) هو مصدر الصورة المرفوعة.
 */
export class CategoryMediaSlotParamDto {
  @IsUUID()
  id: string;

  @IsIn(['icon', 'cover'])
  slot: 'icon' | 'cover';
}
