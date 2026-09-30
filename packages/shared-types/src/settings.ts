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
  is_deprecated: boolean;
  deprecation_reason: string | null;
  /** الحدود اللي السيرفر بيفرضها على الحفظ (docs/08 §188). `null` = مفيش حد مسجّل للمفتاح ده. */
  allowed_range: { min: number; max: number; integer: boolean } | null;
}
