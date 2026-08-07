import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicePlatform } from '../../auth/entities/refresh-token.entity';

export class RegisterDeviceDto {
  @IsString()
  @MaxLength(128)
  device_id: string;

  @IsOptional()
  @IsString()
  fcm_token?: string;

  @IsEnum(DevicePlatform)
  platform: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  os_version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  app_version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  device_model?: string;
}
