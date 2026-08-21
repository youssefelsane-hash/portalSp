import { IsOptional, IsUUID } from 'class-validator';

export class ExceptionCenterQueryDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;
}
