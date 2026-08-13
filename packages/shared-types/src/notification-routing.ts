export type NotificationChannel = 'push' | 'sms' | 'email' | 'in_app' | 'whatsapp';

export interface RoutingRuleResponseDto {
  id: string;
  event_type: string;
  role_name: string;
  channels: NotificationChannel[];
  is_active: boolean;
  updated_at: string;
}

export interface CreateRoutingRuleBody {
  event_type: string;
  role_name: string;
  channels: NotificationChannel[];
}

export interface UpdateRoutingRuleBody {
  channels?: NotificationChannel[];
  is_active?: boolean;
}

// RoleResponseDto اتنقل لـ roles.ts (باني الأدوار الديناميكي، ADR-0010) — بيتصدّر من نفس
// الحزمة (`@baytak/shared-types`) زي ما هو، مفيش تغيير على أي كود بيستورده.
