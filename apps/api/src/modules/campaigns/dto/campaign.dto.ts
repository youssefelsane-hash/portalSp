import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CAMPAIGN_TYPES, CampaignType } from '../entities/notification-campaign.entity';
import { INTENT_STAGES, IntentStage } from '../entities/customer-service-intent.entity';

export class CreateCampaignDto {
  @IsIn(CAMPAIGN_TYPES as unknown as string[])
  campaign_type: CampaignType;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title_template_ar: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  body_template_ar: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  cooldown_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080) // أسبوع بالدقايق — أي تأخير أطول من كده معناه الرسالة فقدت سياقها أصلاً
  trigger_delay_minutes?: number;

  @IsOptional()
  @IsUUID()
  category_id?: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title_template_ar?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  body_template_ar?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  cooldown_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  trigger_delay_minutes?: number;
}

// قايمة "عملاء متروكين" لمركز الاتصال (docs/08 §79) — نافذة زمنية اختيارية (سقفها 30 يوم،
// نفس مدة الاحتفاظ الفعلية بـcustomer_service_intents في campaigns.service.ts's purgeOldIntents()).
export class AbandonedLeadsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page?: number;
}

export class RecordServiceIntentDto {
  @IsUUID()
  service_id: string;

  @IsOptional()
  @IsIn(INTENT_STAGES as unknown as string[])
  intent_stage?: IntentStage;
}
