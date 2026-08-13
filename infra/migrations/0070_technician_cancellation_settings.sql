-- baytak — 0070: إعدادات سياسة إلغاء الفني القابلة للتعديل من لوحة الأدمن (نفس محرك settings
-- الموجود، صفر UI جديد — /settings بيعرض group_name جديد تلقائيًا). القيم الافتراضية هنا
-- "قيم تجريبية معقولة" مش قرار نهائي، زي كل الأرقام التجارية التانية في المشروع (نقاط الولاء،
-- مكافأة الترشيح، ...) — قابلة للتغيير الفوري من الأدمن.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('cancellation.technician_self_cancel_enabled',   'true', 'boolean', 'cancellation', 'هل مسموح للفني يلغي طلب اتقبله بنفسه (تفعيل/تعطيل عام للميزة كلها)', false),
  ('cancellation.window_minutes_after_acceptance',  '10',   'number',  'cancellation', 'عدد الدقايق المسموحة بعد قبول الفني للطلب اللي يقدر يلغي فيها بنفسه من غير تدخّل الدعم', false),
  ('cancellation.min_minutes_before_scheduled_start','60',  'number',  'cancellation', 'أقل عدد دقايق قبل موعد الطلب المجدول (لو موجود) اللي بعده الإلغاء الذاتي بيتمنع', false),
  ('cancellation.auto_rematch_enabled',             'true', 'boolean', 'cancellation', 'لما فني يلغي طلب مش مختار يدويًا من العميل — نرجّعه فورًا للمطابقة التلقائية (true) ولا نستنى العميل يختار بديل بنفسه (false)', false),
  ('cancellation.team_workers_can_self_cancel',     'false','boolean', 'cancellation', 'هل عضو فريق عادي (worker) يقدر يلغي طلب فريق/شركة بنفسه، ولا لازم يعدّي من المدير/المالك بس', false);
