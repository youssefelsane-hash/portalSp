import { Notification } from '../entities/notification.entity';
import { UserDevice } from '../entities/user-device.entity';

export interface NotificationResponseDto {
  id: string;
  notification_type: string;
  channel: string;
  title_ar: string;
  body_ar: string;
  deep_link: string | null;
  reference_type: string | null;
  reference_id: string | null;
  delivery_status: string;
  read_at: string | null;
  created_at: string;
}

export function toNotificationResponseDto(notification: Notification): NotificationResponseDto {
  return {
    id: notification.id,
    notification_type: notification.notificationType,
    channel: notification.channel,
    title_ar: notification.titleAr,
    body_ar: notification.bodyAr,
    deep_link: notification.deepLink,
    reference_type: notification.referenceType,
    reference_id: notification.referenceId,
    delivery_status: notification.deliveryStatus,
    read_at: notification.readAt ? notification.readAt.toISOString() : null,
    created_at: notification.createdAt.toISOString(),
  };
}

export interface UserDeviceResponseDto {
  id: string;
  device_id: string;
  platform: string;
  is_active: boolean;
  last_active_at: string;
}

export function toUserDeviceResponseDto(device: UserDevice): UserDeviceResponseDto {
  return {
    id: device.id,
    device_id: device.deviceId,
    platform: device.platform,
    is_active: device.isActive,
    last_active_at: device.lastActiveAt.toISOString(),
  };
}
