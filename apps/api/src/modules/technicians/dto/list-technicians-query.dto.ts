import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { TechnicianLevel, TechnicianVerificationStatus } from '../entities/technician-profile.entity';

export class ListTechniciansQueryDto {
  @IsOptional()
  @IsEnum(TechnicianVerificationStatus)
  verification_status?: TechnicianVerificationStatus;

  @IsOptional()
  @IsEnum(TechnicianLevel)
  level?: TechnicianLevel;

  /**
   * بحث نصّي حر (docs/08 §77-C1، طلب مالك): «محرك بحث بسيط يكون بيسألك برقم التليفون وبالاسم
   * وبرقم البطاقة اللي هو الناشونال ID».
   *
   * الصفحة كانت فيها فلتر حالة توثيق **بس** — يعني الوصول لفني بعينه كان تقليب صفحة صفحة.
   *
   * **الرقم القومي بيتعامل معاه بشكل مختلف تمامًا عن باقي الحقول** — راجع
   * `AdminTechniciansService.list()`: القيمة مشفّرة بتشفير عشوائي فمستحيل `LIKE` عليها،
   * والبحث بيمر على الـblind index (ADR-0045).
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page?: number = 20;
}
