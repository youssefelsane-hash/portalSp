-- ٥٢ نوع إشعار بيتبعت من الكود ومالوش صف في `notification_type_configs`
-- (تدقيق ماراثوني 2026-09-13، docs/08 §148).
--
-- ## ليه ده مهم
--
-- `NotificationsService.resolveConfiguredChannels()` بتقرا القنوات من الجدول ده لما الكولر
-- مايحددش قناة صراحةً. **نوع بلا صف ⇒ `in_app` بس** — يعني الإشعار بيتسجّل جوّه التطبيق
-- ومابيوصلش الموبايل خالص. ٢٢ نوع من دول بيتبعتوا بـ`notify()` بلا قناة، فكانوا كلهم بلا push:
--
--   payment_instapay_confirmed   ← العميل حوّل والأدمن أكّد، ومحدش بيبلّغه
--   payment_instapay_rejected    ← تحويله اترفض، ولازم يعيد
--   order_reassigned_to_you      ← شغلانة اتحوّلت لفني تاني
--   preferred_crew_invited       ← دعوة انضمام لطاقم
--   installment_payment_failed   ← قسط فشل، والعميل لازم يتصرف
--   recurring_order_awaiting_payment، rating_received، payout_completed، …
--
-- والتعليق في `notification-type-config.service.ts` بيقول القاعدة صراحةً: «صف
-- `notification_type_configs` بيتولّد لما نوع إشعار جديد يتضاف في الكود نفسه (migration seed)» —
-- الأنواع دي اتضافت في الكود والـseed مامشيش وراها. ومن غير الصف، الشاشة `/admin/notification-types`
-- مابتعرضهمش أصلاً، فالأدمن معندوش أي طريقة يظبّط قناتهم أو أولويتهم.
--
-- ## القنوات
--
-- الكل `["in_app","push"]` — نفس العرف الغالب (٣٧ صف من ٤١ الموجودين). `in_app` **سجل**
-- و`push` **توصيل** (نفس قاعدة `resolveConfiguredChannels`). الأنواع اللي بتتوجّه لموظفين عبر
-- `notification_routing_rules` قنواتها بتيجي من قاعدة التوجيه صراحةً، فالصف هنا **مابيغيّرش**
-- توصيلها — بيخلّيها بس مرئية وقابلة للضبط في شاشة الأدمن.
--
-- ## `otp` مستثنى عمدًا
--
-- بيتبعت عبر مزوّد SMS مباشرةً (`auth.service.ts` بـ`targets`)، مش عبر `notify()` — فمالوش
-- علاقة بالجدول ده أصلاً.
--
-- ## الطبقات
--
-- `action_required` = المستخدم لازم ياخد قرار (عرض/دفعة/موافقة). `scheduled_job` = تذكير
-- بموعد. الباقي `informational`. الصوت مقصور على اللي فعلاً عرض شغل (نفس `order_offer`).

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels, sound_key, is_actionable)
VALUES
  -- ── قرار مطلوب من المستخدم ──────────────────────────────────────────────
  ('order_reassigned_to_you',            'action_required', '["in_app","push"]'::jsonb, 'order_offer_alert', true),
  ('preferred_crew_invited',             'action_required', '["in_app","push"]'::jsonb, 'order_offer_alert', true),
  ('recurring_order_awaiting_payment',   'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('installment_payment_failed',         'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('payment_instapay_rejected',          'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_quote_expired_technician',     'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_assessment_info_requested',    'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_locked_provider_lost',         'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_quote_expired',                'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_photo_quote_requested',        'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_quote_above_range_submitted',  'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_no_technician_found',          'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('payout_requires_review',             'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('security_critical_event',            'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('admin_mfa.recovery_used',            'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_emergency_created',            'action_required', '["in_app","push"]'::jsonb, 'critical_offer_alert', false),
  ('order_emergency_dispatch_struggling','action_required', '["in_app","push"]'::jsonb, 'critical_offer_alert', false),
  ('order_crew_shortage_escalated',      'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('assistant_matching_escalated',       'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_locked_provider_lost_ops',     'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('recurring_template_generation_failing','action_required','["in_app","push"]'::jsonb, NULL, false),
  ('support_chat_message_received',      'action_required', '["in_app","push"]'::jsonb, NULL, false),

  -- ── تذكير بموعد ────────────────────────────────────────────────────────
  ('crew_shortage_leader_reminder',      'scheduled_job',   '["in_app","push"]'::jsonb, 'scheduled_job_soft', false),

  -- ── إخبارية ────────────────────────────────────────────────────────────
  ('payment_instapay_confirmed',         'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('payment_instapay_transfer_reported', 'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('installment_application_submitted',  'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('installment_application_submitted_ops','informational', '["in_app","push"]'::jsonb, NULL, false),
  ('installment_payment_failed_ops',     'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('installment_payment_succeeded',      'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('installment_plan_completed',         'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('assistant_assigned',                 'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('crew_member_added',                  'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('crew_member_removed',                'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('preferred_crew_accepted',            'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('first_order_offer',                  'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('loyalty_points_expired',             'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('rating_received',                    'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('low_rating_submitted',               'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('payout_completed',                   'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('cash_collected',                     'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('complaint_filed',                    'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('technician_kpi_bonus_paid',          'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('technician_progression_promoted',    'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('technician_referral.bonus_credited', 'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('technician_referral.bonus_revoked',  'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('order_photo_quote_accepted',         'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('order_quote_above_range_rejected',   'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('order_quote_expired_ops',            'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('order_routed_to_onsite_assessment',  'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('order_technician_cancelled_ops',     'informational',   '["in_app","push"]'::jsonb, NULL, false),
  ('order_reschedule_requested',         'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('order_rescheduled',                  'informational',   '["in_app","push"]'::jsonb, NULL, false)
ON CONFLICT (notification_type) DO NOTHING;
