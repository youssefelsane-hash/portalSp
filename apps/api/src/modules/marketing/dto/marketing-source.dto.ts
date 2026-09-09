import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MARKETING_CHANNELS, MarketingChannel, MarketingSource } from '../entities/marketing-source.entity';

/** حد أعلى للعمولة (١٠٬٠٠٠ ج.م بالقرش) — حارس ضد صفر زيادة بالغلط في خانة إدخال. */
const MAX_PAYOUT_CENTS = 1_000_000;

export class CreateMarketingSourceDto {
  @IsString()
  @Length(2, 120)
  name_ar: string;

  @IsIn(MARKETING_CHANNELS)
  channel: MarketingChannel;

  /** لو اتساب فاضي، السيرفر بيولّد كود قصير بحروف مالهاش لبس في القراءة اليدوية. */
  @IsOptional()
  @IsString()
  @Length(3, 24)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  region_label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PAYOUT_CENTS)
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

export class UpdateMarketingSourceDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name_ar?: string;

  @IsOptional()
  @IsIn(MARKETING_CHANNELS)
  channel?: MarketingChannel;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  region_label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PAYOUT_CENTS)
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

export class MarkCommissionsPaidDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @Type(() => String)
  ids: string[];

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export interface MarketingSourceResponseDto {
  id: string;
  code: string;
  name_ar: string;
  channel: MarketingChannel;
  region_label: string | null;
  notes: string | null;
  is_active: boolean;
  payout_per_completed_order_cents: number;
  payout_contact_name: string | null;
  payout_contact_phone: string | null;
  /** الرابط الجاهز للطباعة تحت QR — بيتبني من `PUBLIC_BASE_URL` مش متخزّن. */
  share_url: string;
  created_at: string;
}

export function toMarketingSourceResponseDto(source: MarketingSource, baseUrl: string): MarketingSourceResponseDto {
  return {
    id: source.id,
    code: source.code,
    name_ar: source.nameAr,
    channel: source.channel,
    region_label: source.regionLabel,
    notes: source.notes,
    is_active: source.isActive,
    payout_per_completed_order_cents: source.payoutPerCompletedOrderCents,
    payout_contact_name: source.payoutContactName,
    payout_contact_phone: source.payoutContactPhone,
    // **مايتخزنش**: الدومين بيتغيّر (staging، دومين تسويقي جديد)، ورابط متخزّن كان هيفضل
    // يشاور على العنوان القديم في كل مصدر اتعمل قبل التغيير.
    share_url: `${baseUrl.replace(/\/+$/, '')}/r/${source.code}`,
    created_at: source.createdAt.toISOString(),
  };
}
