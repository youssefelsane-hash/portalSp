-- Script 4 Part K §42 — إعادة جدولة عامة من الأدمن. كانت فجوة موثّقة صراحة: OrdersService.reschedule()
-- مقصور على العميل صاحب الطلب بس (findOneOwnedOrThrow) — مفيش مسار أدمن لتنفيذ طلب تأجيل نيابة
-- عن العميل (خدمة العملاء بتستقبل مكالمات "أجّلولي الميعاد" وبترجع تدخل يدوي على الداتابيز).

-- نفس نمط منح orders.assign_assistant/orders.manage_crew لـsuper_admin+ops_manager — عملية
-- تشغيلية يومية، مش قرار يحتاج صلاحية super_admin فقط.
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.reschedule', 'orders', 'reschedule');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.reschedule'
WHERE r.name IN ('super_admin', 'ops_manager');
