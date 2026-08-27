import { CampaignWithStats } from '../admin-campaigns.service';

export interface CampaignResponseDto {
  id: string;
  campaign_type: string;
  name: string;
  title_template_ar: string;
  body_template_ar: string;
  is_active: boolean;
  cooldown_days: number;
  priority: number;
  trigger_delay_minutes: number | null;
  category_id: string | null;
  sends_30d: number;
  last_sent_at: string | null;
  // معاينة بأسماء وهمية — الأدمن يشوف الشكل النهائي قبل ما يفعّل الحملة.
  preview_title: string;
  preview_body: string;
  // متغيّرات مكتوبة غلط في القالب — تحذير للأدمن، مش رفض للحفظ.
  unknown_variables: string[];
}

export function toCampaignResponseDto(row: CampaignWithStats): CampaignResponseDto {
  return {
    id: row.campaign.id,
    campaign_type: row.campaign.campaignType,
    name: row.campaign.name,
    title_template_ar: row.campaign.titleTemplateAr,
    body_template_ar: row.campaign.bodyTemplateAr,
    is_active: row.campaign.isActive,
    cooldown_days: row.campaign.cooldownDays,
    priority: row.campaign.priority,
    trigger_delay_minutes: row.campaign.triggerDelayMinutes,
    category_id: row.campaign.categoryId,
    sends_30d: row.sends30d,
    last_sent_at: row.lastSentAt ? new Date(row.lastSentAt).toISOString() : null,
    preview_title: row.previewTitle,
    preview_body: row.previewBody,
    unknown_variables: row.unknownVariables,
  };
}
