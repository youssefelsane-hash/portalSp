import { IsBoolean } from 'class-validator';

export class UpdateNotificationPreferenceDto {
  @IsBoolean()
  is_enabled: boolean;
}
