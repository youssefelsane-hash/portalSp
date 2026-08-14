import type { NotificationChannel } from './notification-routing';

// إعداد الأولوية/الصوت/القناة/actionable لكل notification_type (ADR-0012) — مطابق لـ
// apps/api/src/modules/notifications/entities/notification-type-config.entity.ts
export type NotificationPriorityTier = 'critical_offer' | 'action_required' | 'scheduled_job' | 'informational';

export interface NotificationTypeConfigResponseDto {
  id: string;
  notification_type: string;
  priority_tier: NotificationPriorityTier;
  default_channels: NotificationChannel[];
  sound_key: string | null;
  is_actionable: boolean;
  action_labels: Record<string, string> | null;
  requires_acknowledgment: boolean;
  updated_at: string;
}

export interface UpdateNotificationTypeConfigBody {
  priority_tier?: NotificationPriorityTier;
  default_channels?: NotificationChannel[];
  sound_key?: string;
  is_actionable?: boolean;
  action_labels?: Record<string, string>;
  requires_acknowledgment?: boolean;
}
