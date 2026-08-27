// محرك حملات التسويق (ADR-0046، docs/08 §74-أ) — أنواع مشتركة بين apps/api و apps/admin.

export type CampaignType = 'periodic_promo' | 'abandoned_intent';

export interface CampaignResponseDto {
  id: string;
  campaign_type: CampaignType;
  name: string;
  title_template_ar: string;
  body_template_ar: string;
  is_active: boolean;
  /** أقل عدد أيام بين إرسالين من **نفس** الحملة لنفس العميل. */
  cooldown_days: number;
  /** الأعلى بيظهر أكتر في الاختيار المرجّح — مش ترتيب مطلق. */
  priority: number;
  /** لـ`abandoned_intent` بس: بعد كام دقيقة من الاهتمام المتروك نبعت. */
  trigger_delay_minutes: number | null;
  category_id: string | null;
  /** إرسالات آخر 30 يوم — الرقم اللي بيقول للأدمن الحملة شغالة فعلاً ولا نايمة. */
  sends_30d: number;
  last_sent_at: string | null;
  /** معاينة النص بأسماء وهمية — الشكل النهائي قبل التفعيل. */
  preview_title: string;
  preview_body: string;
  /** متغيّرات مكتوبة غلط في القالب — تحذير للأدمن، مش رفض للحفظ. */
  unknown_variables: string[];
}

export interface CampaignsListResponseDto {
  items: CampaignResponseDto[];
  /** المتغيّرات المتاحة للاستخدام في القوالب — الواجهة بتعرضها للأدمن وهو بيكتب. */
  available_variables: string[];
}

export interface CreateCampaignBody {
  campaign_type: CampaignType;
  name: string;
  title_template_ar: string;
  body_template_ar: string;
  is_active?: boolean;
  cooldown_days?: number;
  priority?: number;
  trigger_delay_minutes?: number;
  category_id?: string;
}

export type UpdateCampaignBody = Partial<Omit<CreateCampaignBody, 'campaign_type' | 'category_id'>>;
