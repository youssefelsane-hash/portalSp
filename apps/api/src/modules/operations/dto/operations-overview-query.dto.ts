import { IsOptional, IsUUID } from 'class-validator';

export class OperationsOverviewQueryDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;
}
