import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { OrderItemType } from '../entities/order-item.entity';

// 'service' مش مسموح هنا عمداً — الفني بيقترح بنود إضافية بس (قطع غيار/أجرة إضافية/إضافات)،
// مش بند الخدمة الأساسي (ده بيتحدد وقت إنشاء الطلب من الكتالوج).
const PROPOSABLE_ITEM_TYPES = [OrderItemType.ADDON, OrderItemType.SPARE_PART, OrderItemType.EXTRA_LABOR];

export class QuoteItemDto {
  @IsIn(PROPOSABLE_ITEM_TYPES)
  item_type: OrderItemType;

  @IsString()
  @MaxLength(160)
  name_ar: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsPositive()
  @Max(9999)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit_name?: string;

  @IsInt()
  @Min(0)
  @Max(100_000_00) // 100,000 جنيه سقف دفاعي — مفيش رقم رسمي في القاموس، حماية من خطأ إدخال مش سياسة تسعير
  unit_price_cents: number;
}

export class ProposeQuoteItemsDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items: QuoteItemDto[];
}
