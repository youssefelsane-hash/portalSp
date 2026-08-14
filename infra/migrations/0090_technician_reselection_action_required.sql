-- baytak — 0090: توصيل action_required تاني — العميل لازم يختار فني بديل بنفسه بعد إلغاء الفني
-- (سياسة إلغاء الفني، docs/10 + ADR-0012، docs/08 §15، متبقٍ صريح من Phase 1).
--
-- نوع جديد منفصل عن order_technician_cancelled الموجود (لسه بيتستخدم للحالة التانية —
-- AUTO_REMATCH، إعادة مطابقة تلقائية، إشعار واحد بس بلا تكرار — نفس تصحيح المالك الصريح: "الرفض
-- نفسه مش المهم، المهم هل العميل مطلوب منه يعمل حاجة"). النوعين بيتشاركوا نفس الحدث
-- (TECHNICIAN_ORDER_CANCELLED_EVENT) بس بمعنى مختلف تمامًا — يستحقوا notification_type منفصل.
INSERT INTO notification_type_configs (notification_type, priority_tier, requires_acknowledgment) VALUES
  ('order_technician_cancelled_manual_reselection', 'action_required', false)
ON CONFLICT (notification_type) DO NOTHING;
