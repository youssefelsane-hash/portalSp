// مطابق لـ apps/api/src/modules/feature-flags/dto/*.ts
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

export interface CreateFeatureFlagBody {
  key: string;
  is_enabled?: boolean;
  rollout_percentage?: number;
  enabled_for_user_ids?: string[];
  enabled_for_zone_ids?: string[];
  description?: string;
}

export type UpdateFeatureFlagBody = Partial<Omit<CreateFeatureFlagBody, 'key'>>;
