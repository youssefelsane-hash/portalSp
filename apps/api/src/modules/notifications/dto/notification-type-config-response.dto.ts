import { NotificationTypeConfig } from '../entities/notification-type-config.entity';

export interface NotificationTypeConfigResponseDto {
  id: string;
  notification_type: string;
  priority_tier: string;
  default_channels: string[];
  sound_key: string | null;
  is_actionable: boolean;
  action_labels: Record<string, string> | null;
  requires_acknowledgment: boolean;
  updated_at: string;
}

export function toNotificationTypeConfigResponseDto(config: NotificationTypeConfig): NotificationTypeConfigResponseDto {
  return {
    id: config.id,
    notification_type: config.notificationType,
    priority_tier: config.priorityTier,
    default_channels: config.defaultChannels,
    sound_key: config.soundKey,
    is_actionable: config.isActionable,
    action_labels: config.actionLabels,
    requires_acknowledgment: config.requiresAcknowledgment,
    updated_at: config.updatedAt.toISOString(),
  };
}
