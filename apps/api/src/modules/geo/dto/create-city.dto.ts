import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class CreateCityDto {
  @IsUUID()
  country_id: string;

  @IsString()
  @MaxLength(120)
  name_ar: string;

  @IsString()
  @MaxLength(120)
  name_en: string;

  @IsString()
  @Length(2, 120)
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  timezone?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
