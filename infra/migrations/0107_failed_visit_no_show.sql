-- baytak — 0107: زيارة فاشلة/عدم حضور — تصنيف شكوى جديد + رسوم زيارة قابلة للإعداد + صلاحية أدمن (docs/08 §22 بند 3-6)
-- كانت فجوة موثّقة صراحة: صفر آلية لتسجيل زيارة فشلت (عميل مش موجود/رفض شغل ضروري) — إعادة استخدام
-- كامل لبنية complaints الموجودة (docs/08 §20/§21 نفس النمط)، صفر جدول جديد.

-- تصنيف شكوى جديد يميّز "العميل رفض شغل ضروري لإتمام الطلب صح" عن no_show العادي (عميل مش موجود
-- خالص) — تصنيفين مختلفين جذريًا للأدمن وقت المراجعة، رغم إن الاتنين بيوديو لنفس مسار "زيارة فاشلة".
ALTER TYPE complaint_category ADD VALUE 'required_work_rejected';

-- رسوم الزيارة الفاشلة (docs/08 §22 بند 5) — بيتطبّق بس على الطلبات المدفوعة مسبقًا (يتخصم من
-- الاسترداد)، الطلبات الكاش صفر رسوم دايمًا (المنصة تمتص تكلفة الفني، مفيش فلوس عميل نتخيلها).
-- نفس نمط orders.cancellation_free_window_min تمامًا (group_name='limits', رقم بالقرش).
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('orders.no_show_visit_fee_cents', '5000', 'number', 'limits', 'رسوم الزيارة الفاشلة (عدم حضور/رفض شغل ضروري) اللي الأدمن بيطبّقها على الطلبات المدفوعة مسبقًا بالقرش', false);

-- صلاحية أدمن مخصوصة لحل الزيارات الفاشلة (رسوم + استرداد جزئي/كامل) — نفس نمط orders.adjust_price
-- في migration 0034 بالحرف، نفس مستوى حساسية مالية (مُدرجة في MFA_REQUIRED_PERMISSIONS بالكود).
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.resolve_failed_visit', 'orders', 'resolve_failed_visit');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.resolve_failed_visit'
WHERE r.name IN ('super_admin', 'ops_manager');
