import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicePlatform } from '../entities/refresh-token.entity';

// اختياري بالكامل — العميل بيولّد device_id مرة واحدة ويخزّنه محليًا (نفس فلسفة
// notifications' RegisterDeviceDto، بس لجدول/غرض مختلف تمامًا — إدارة جلسات ADR-0011 §5).
export class DeviceMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  device_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  device_name?: string;

  @IsOptional()
  @IsEnum(DevicePlatform)
  device_platform?: DevicePlatform;
}
