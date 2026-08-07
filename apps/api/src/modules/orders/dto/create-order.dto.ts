import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { OrderType } from '../entities/order.entity';

export class CreateOrderDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;

  @IsOptional()
  @IsEnum(OrderType)
  order_type?: OrderType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  problem_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customer_notes?: string;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  promo_code?: string;
}
