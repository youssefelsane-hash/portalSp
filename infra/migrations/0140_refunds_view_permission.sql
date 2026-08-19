-- Script 7 Phase 17 (Refunds) — بَقّة حقيقية اتلقطت أثناء تحقيق "refund عالق PROCESSING للأبد"
-- (بند صريح مطلوب استقصاؤه): رسالة الرفض في refundOrder() ("راجع الطلب يدويًا عبر
-- provider.reconcile قبل إعادة المحاولة") بتفترض وجود مسار مراجعة إداري — لكن **مفيش GET
-- /admin/refunds خالص**، فالأدمن معندوش أي طريقة يشوف بيها إن فيه استردادات عالقة في PROCESSING
-- من الأساس (غير استعلام DB مباشر). نفس فئة البَقّة الأمنية اللي migration 0099 صلّحتها لـ
-- payouts/wallets (بيانات مالية حساسة بلا صلاحية قراءة مخصوصة).
INSERT INTO permissions (name, resource, action) VALUES
  ('refunds.view', 'refunds', 'view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'refunds.view'
WHERE r.name = 'finance';
