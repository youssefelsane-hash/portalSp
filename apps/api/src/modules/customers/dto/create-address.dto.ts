import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsPhoneNumber, IsString, IsUUID, Length } from 'class-validator';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  label?: string;

  @IsUUID()
  city_id: string;

  @IsUUID()
  area_id: string;

  @IsString()
  @Length(2, 160)
  street_name: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  building_number?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  floor_number?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  apartment_number?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  landmark?: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  contact_name?: string;

  @IsOptional()
  @IsPhoneNumber(undefined)
  contact_phone?: string;

  @IsOptional()
  @IsString()
  delivery_notes?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}
