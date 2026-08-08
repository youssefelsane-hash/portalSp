// مطابق لـ apps/api/src/modules/settings/dto/setting-response.dto.ts
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
