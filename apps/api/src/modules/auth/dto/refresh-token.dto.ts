import { IsString } from 'class-validator';
import { DeviceMetadataDto } from './device-metadata.dto';

export class RefreshTokenDto extends DeviceMetadataDto {
  @IsString()
  refresh_token: string;
}
