import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  order_status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

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
