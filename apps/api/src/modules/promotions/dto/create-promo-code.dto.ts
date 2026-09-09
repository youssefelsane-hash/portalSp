import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { DiscountType } from '../entities/promo-code.entity';
import { MARKETING_CHANNELS } from '../../marketing/entities/marketing-source.entity';
import type { MarketingChannel } from '../../marketing/entities/marketing-source.entity';

export class CreatePromoCodeDto {
  @IsString()
  @Length(3, 24)
  code: string;

  @IsString()
  @MaxLength(120)
  name_ar: string;

  @IsEnum(DiscountType)
  discount_type: DiscountType;

  @IsNumber()
  @ValidateIf(
    (dto: CreatePromoCodeDto) => dto.discount_enabled !== false && dto.discount_type !== DiscountType.FREE_INSPECTION,
  )
  @IsPositive()
  discount_value: number;

  @IsOptional()
  @IsBoolean()
  discount_enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  max_discount_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  min_order_amount_cents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  usage_limit_total?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  usage_limit_per_user?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  applies_to_service_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  applies_to_zone_ids?: string[];

  @IsOptional()
  @IsBoolean()
  new_customers_only?: boolean;

  @IsDateString()
  valid_from: string;

  @IsDateString()
  valid_until: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  budget_cents?: number;

  // إصلاح أمني (migration 0067) — لو موجود، الكود ده مينفعش يتستخدم إلا من الـuser ده بالظبط.
  @IsOptional()
  @IsUUID()
  restricted_to_user_id?: string;

  @IsOptional()
  @IsIn(MARKETING_CHANNELS)
  marketing_channel?: MarketingChannel;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  marketing_region_label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  marketing_notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  payout_per_completed_order_cents?: number;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  payout_contact_name?: string;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  payout_contact_phone?: string;
}
