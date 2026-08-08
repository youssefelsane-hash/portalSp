import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
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

  // إضافات جاهزة من كتالوج الخدمة نفسها (service_addons) — بتتحط في order_items بـ
  // is_customer_approved=true فوراً (العميل اختارها بنفسه وقت الحجز، مش عرض سعر مستني موافقة).
  // مختلفة عن مسار awaiting_quote_approval (order-items.service.ts) اللي الفني بيقترحه أثناء الشغل.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  addon_ids?: string[];
}
