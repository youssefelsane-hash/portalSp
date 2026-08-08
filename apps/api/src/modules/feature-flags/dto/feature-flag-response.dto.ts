import { FeatureFlag } from '../entities/feature-flag.entity';

export interface FeatureFlagResponseDto {
  id: string;
  key: string;
  is_enabled: boolean;
  rollout_percentage: number;
  enabled_for_user_ids: string[] | null;
  enabled_for_zone_ids: string[] | null;
  description: string | null;
  created_at: string;
}

export function toFeatureFlagResponseDto(flag: FeatureFlag): FeatureFlagResponseDto {
  return {
    id: flag.id,
    key: flag.key,
    is_enabled: flag.isEnabled,
    rollout_percentage: flag.rolloutPercentage,
    enabled_for_user_ids: flag.enabledForUserIds,
    enabled_for_zone_ids: flag.enabledForZoneIds,
    description: flag.description,
    created_at: flag.createdAt.toISOString(),
  };
}
