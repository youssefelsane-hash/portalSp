-- baytak — 0293: صلاحيات محرك التحليلات (ADR-0081 / ADR-0074)
--
-- صلاحيتين مش واحدة، لنفس السبب اللي خلّى `reports.view` تتقسّم عن `reports.view_revenue` في
-- 0099: لوحة الفنل تشغيلية (فين بنفقد العملاء؟) ولوحة المال بتعرض دخل الشركة وهوامشها.
-- مدير العمليات محتاج الأولى ومالوش دعوة بالتانية.
--
-- `analytics.financial.view` بتتسجّل هنا مع الأولى رغم إن شاشتها بتتبني في مرحلة لاحقة —
-- عشان مايبقاش فيه migration تاني بيضيف صلاحية واحدة، والـvalidator بتاع ADR-0074 بيتأكد إن
-- أي اسم صلاحية في `@RequirePermission` موجود في الكتالوج قبل ما التطبيق يقلع.

INSERT INTO permissions (name, resource, action) VALUES
  ('analytics.view', 'analytics', 'view'),
  ('analytics.financial.view', 'analytics', 'financial_view')
ON CONFLICT (name) DO NOTHING;

-- مين بيقرا التقارير التشغيلية دلوقتي بياخد لوحة التحليلات — مشتقّ من البيانات مش من قايمة
-- أدوار مكتوبة بالإيد، فبيمشي على أي دور مخصّص المشغّل عامله في الإنتاج كمان.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'reports.view'
JOIN permissions target ON target.name = 'analytics.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ومين بيشوف الإيراد بياخد اللوحة المالية. نفس القسمة بالظبط.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'reports.view_revenue'
JOIN permissions target ON target.name = 'analytics.financial.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
