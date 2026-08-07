import { IsOptional, IsUUID } from 'class-validator';

export class ListServicesDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;
}

export class EstimateQueryDto {
  @IsOptional()
  @IsUUID()
  zone_id?: string;
}
