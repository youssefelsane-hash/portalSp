import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class LiveDispatchQueryDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;

  /** «وريني اللي واقف بس» — التصفية بتتم على الحالة المشتقة من نفس قاعدة الـworkflow، مش على وقت خام. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  only_delayed?: boolean;
}
