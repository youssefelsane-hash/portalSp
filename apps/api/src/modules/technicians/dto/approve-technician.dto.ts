import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * ADR-0117 — body اختياري: فاضي = اعتماد عادي (نفس السلوك القديم). `override_reason` بيتقري بس لو بوابة
 * الأكاديمية مفتوحة والفني لسه ماخلّصش الإلزامي، وبيتقبل من super_admin بس.
 */
export class ApproveTechnicianDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  override_reason?: string;
}
