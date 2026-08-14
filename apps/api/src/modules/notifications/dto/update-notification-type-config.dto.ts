import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationPriorityTier } from '../entities/notification-type-config.entity';

export class UpdateNotificationTypeConfigDto {
  @IsOptional()
  @IsEnum(NotificationPriorityTier)
  priority_tier?: NotificationPriorityTier;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(NotificationChannel, { each: true })
  default_channels?: NotificationChannel[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sound_key?: string;

  @IsOptional()
  @IsBoolean()
  is_actionable?: boolean;

  // مفاتيح/قيم حرة (مثلاً {"accept": "قبول", "reject": "رفض"}) — الأفعال المتاحة تختلف حسب
  // notification_type نفسه، مفيش قايمة ثابتة تتحقق منها هنا.
  @IsOptional()
  @IsObject()
  action_labels?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  requires_acknowledgment?: boolean;
}
