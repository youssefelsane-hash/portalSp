import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PricingFieldType } from '../entities/service-pricing-field.entity';

export class PricingFieldOptionDto {
  @IsString()
  @Length(1, 60)
  value: string;

  @IsString()
  @Length(1, 120)
  label_ar: string;
}

export class CreatePricingFieldDto {
  // اسم برمجي — بيتستخدم كمرجع field_ref جوّه المعادلة، يبقى ASCII بسيط عشان مايتلخبطش مع
  // أسماء الحقول العربية المعروضة (label_ar منفصل تمامًا لده).
  @IsString()
  @Length(1, 60)
  @Matches(/^[a-z][a-z0-9_]*$/, { message: 'field_key لازم يكون حروف إنجليزي صغيرة وأرقام و_ بس، يبدأ بحرف' })
  field_key: string;

  @IsString()
  @Length(1, 120)
  label_ar: string;

  @IsEnum(PricingFieldType)
  field_type: PricingFieldType;

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @IsOptional()
  @IsNumber()
  display_order?: number;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  unit_ar?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingFieldOptionDto)
  options?: PricingFieldOptionDto[];

  @IsOptional()
  @IsNumber()
  min_value?: number;

  @IsOptional()
  @IsNumber()
  max_value?: number;

  // قيمة افتراضية اختيارية (Script 6 Part 3/4، migration 0138) — نص خام بيتفسّر حسب field_type
  // وقت الاستخدام (راجع PricingEngineService.resolveDefaultValue). لحقول CHECKBOX من غيرها،
  // الافتراض الضمني false.
  @IsOptional()
  @IsString()
  @Length(1, 255)
  default_value?: string;
}
