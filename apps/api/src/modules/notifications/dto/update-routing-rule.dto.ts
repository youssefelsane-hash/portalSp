import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { NotificationChannel } from '../entities/notification.entity';

export class UpdateRoutingRuleDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(NotificationChannel, { each: true })
  channels?: NotificationChannel[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
