-- baytak — 0098: تدرّج دفعات الطوارئ (docs/08 §17.15) — سياسة مطابقة قابلة للتهيئة بالكامل،
-- صفر أرقام دائمة مكتوبة في الكود (matching.service.ts بيقرأها بـfallback دفاعي بس).

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  (
    'matching.emergency_subsequent_batch_size',
    '10',
    'number',
    'matching',
    'حجم دفعة الفنيين من الجولة التانية لطلبات الطوارئ (matching.emergency_batch_size بيتحكم في أول جولة بس)',
    false
  ),
  (
    'matching.emergency_response_timeout_seconds',
    '20',
    'number',
    'matching',
    'مهلة رد الفني على عرض طلب طوارئ بالثواني (أقصر من matching.response_timeout_seconds العادية — استعجال حقيقي)',
    false
  ),
  (
    'matching.emergency_max_technicians_contacted',
    '40',
    'number',
    'matching',
    'أقصى عدد فنيين يتم التواصل معاهم إجمالاً عبر كل جولات طلب طوارئ واحد — مستقل عن matching.max_rounds (ده بيحدّ عدد الجولات، ده بيحدّ عدد الفنيين)',
    false
  ),
  (
    'matching.emergency_escalation_after_rounds',
    '2',
    'number',
    'matching',
    'عدد جولات التوزيع لطلب طوارئ قبل ما يتصعّد تلقائيًا لإشعار الأدمن/الموظف (order.emergency_dispatch_struggling عبر notification_routing_rules) — مرة واحدة بس لكل طلب',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- نفس نمط order.emergency_created بالحرف (migration 0053) — ops_manager افتراضيًا، قابلة
-- للتعديل/الحذف من /admin/notification-routing-rules.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('order.emergency_dispatch_struggling', 'ops_manager', '["in_app"]')
ON CONFLICT DO NOTHING;
