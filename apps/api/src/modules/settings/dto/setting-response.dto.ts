import { Setting } from '../entities/setting.entity';
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
}

export function toSettingResponseDto(setting: Setting): SettingResponseDto {
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
  };
}
