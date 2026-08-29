import { IsIn, IsUUID } from 'class-validator';

/**
 * خانة صورة الفئة (docs/08 §98) — `icon` أيقونة صغيرة جنب الاسم، `cover` صورة الكارت الكبيرة.
 * الخانتين نفس الأعمدة الموجودة أصلاً (`icon_url` / `cover_image_url`) — صفر عمود جديد.
 */
export class CategoryMediaSlotParamDto {
  @IsUUID()
  id: string;

  @IsIn(['icon', 'cover'])
  slot: 'icon' | 'cover';
}
