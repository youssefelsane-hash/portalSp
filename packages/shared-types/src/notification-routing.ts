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

// `GET /admin/roles` بيرجّع صف `Role` الخام (camelCase) من غير DTO mapper — مفيش snake_case هنا.
export interface RoleResponseDto {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
}
