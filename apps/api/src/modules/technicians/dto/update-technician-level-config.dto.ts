import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateTechnicianLevelConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  display_name_ar?: string;

  @IsOptional()
  @IsNumber()
  @Min(-100)
  @Max(100)
  commission_adjustment_percentage?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order_priority_weight?: number;

  // null صريح = بلا حد (الفني يقبل أي قيمة طلب لوحده)، undefined = مفيش تعديل
  @IsOptional()
  @IsInt()
  @Min(0)
  decision_limit_cents?: number | null;

  @IsOptional()
  @IsBoolean()
  can_lead_team?: boolean;

  @IsOptional()
  @IsBoolean()
  eligible_for_team_booking?: boolean;
}
