import { Setting } from '../entities/setting.entity';
import { SETTINGS_REGISTRY } from '../settings-registry';
import { isSecretSettingKey } from '../settings.service';

export interface SettingResponseDto {
  id: string;
  key: string;
  value: unknown;
  value_type: string;
  group_name: string;
  description: string | null;
  is_public: boolean;
  updated_by_user_id: string | null;
  updated_at: string;
  is_deprecated: boolean;
  deprecation_reason: string | null;
}

export function toSettingResponseDto(setting: Setting): SettingResponseDto {
  const definition = SETTINGS_REGISTRY[setting.key];
  return {
    id: setting.id,
    key: setting.key,
    value: isSecretSettingKey(setting.key) ? (setting.value ? '********' : '') : setting.value,
    value_type: setting.valueType,
    group_name: setting.groupName,
    description: setting.description,
    is_public: setting.isPublic,
    updated_by_user_id: setting.updatedByUserId,
    updated_at: setting.updatedAt.toISOString(),
    is_deprecated: definition?.deprecated === true,
    deprecation_reason: definition?.deprecationReason ?? null,
  };
}
