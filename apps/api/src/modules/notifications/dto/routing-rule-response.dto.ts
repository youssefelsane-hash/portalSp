import { NotificationRoutingRule } from '../entities/notification-routing-rule.entity';

export interface RoutingRuleResponseDto {
  id: string;
  event_type: string;
  role_name: string;
  channels: string[];
  is_active: boolean;
  updated_at: string;
}

export function toRoutingRuleResponseDto(rule: NotificationRoutingRule): RoutingRuleResponseDto {
  return {
    id: rule.id,
    event_type: rule.eventType,
    role_name: rule.roleName,
    channels: rule.channels,
    is_active: rule.isActive,
    updated_at: rule.updatedAt.toISOString(),
  };
}
