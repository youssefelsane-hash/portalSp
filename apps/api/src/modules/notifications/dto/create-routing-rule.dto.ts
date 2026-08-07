import { ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsString, Length } from 'class-validator';
import { NotificationChannel } from '../entities/notification.entity';

export class CreateRoutingRuleDto {
  @IsString()
  @Length(2, 80)
  event_type: string;

  @IsString()
  @Length(2, 60)
  role_name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(NotificationChannel, { each: true })
  channels: NotificationChannel[];
}
