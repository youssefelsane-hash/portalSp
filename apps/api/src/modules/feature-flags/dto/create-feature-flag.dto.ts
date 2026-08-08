import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateFeatureFlagDto {
  @IsString()
  @Length(2, 60)
  key: string;

  @IsOptional()
  @IsBoolean()
  is_enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rollout_percentage?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  enabled_for_user_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  enabled_for_zone_ids?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
