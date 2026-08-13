import { ArrayUnique, IsArray, IsString } from 'class-validator';

// استبدال كامل لقايمة صلاحيات الدور (مش إضافة/حذف جزئي) — أبسط عقد، والواجهة (مصفوفة
// checkboxes) أصلاً بتبعت الحالة النهائية الكاملة كل مرة.
export class SetRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permission_names: string[];
}
