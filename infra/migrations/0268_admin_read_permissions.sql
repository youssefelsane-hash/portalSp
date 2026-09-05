-- تدقيق S-1 — صلاحيات قراءة صريحة لمسارات الأدمن اللي كانت مفتوحة لأي موظف.
--
-- الوضع قبل الـmigration دي: ٩٢ مسار `@Roles(UserType.ADMIN)` مالهمش أي `@RequirePermission`.
-- `PermissionsGuard` fail-open (مفيش ديكوريتور = يعدّي)، وكل موظف في النظام `user_type='admin'`
-- (`admin-employees.service.ts` بيعمل كده لكل موظف جديد) — يعني `@Roles(ADMIN)` مش حدّ صلاحيات
-- أصلاً. النتيجة العملية: موظف دعم عنده `support_tickets.manage` بس كان يقدر يقرا **كشف أرباح أي
-- فني** و**بيانات أي عميل بالكامل** (تليفون، عناوين، تاريخ الطلبات) — من غير أي أثر إنه تخطّى حاجة.
--
-- الـmigration دي بتضيف كتالوج صلاحيات القراءة الناقص، وبتوزّعه على الأدوار القائمة بحيث **مفيش
-- دور بيخسر قدرة كان بيستعملها فعلاً**. `super_admin` مالوش أي سطر هنا عمدًا — `is_super_admin`
-- بيتخطّى الفحص بالكامل في `PermissionsService.getUserPermissionNames()` وبياخد الكتالوج كله.

-- ── ١) كتالوج الصلاحيات الجديدة ────────────────────────────────────────────
-- التسمية متّبعة الاتفاقية القائمة بالحرف: `resource.action`، والنقطة الوسطى في الاسم بتتحوّل
-- شرطة سفلية في `action` (زي `employees.activity.view` الموجود من قبل).
INSERT INTO permissions (name, resource, action) VALUES
  ('academy.view',                 'academy',                'view'),
  ('buildings.view',               'buildings',              'view'),
  ('cancellation_reasons.view',    'cancellation_reasons',   'view'),
  ('catalog.view',                 'catalog',                'view'),
  ('complaints.view',              'complaints',             'view'),
  ('customers.view',               'customers',              'view'),
  ('employees.view',               'employees',              'view'),
  ('feature_flags.view',           'feature_flags',          'view'),
  ('geo.view',                     'geo',                    'view'),
  ('notifications.view',           'notifications',          'view'),
  ('operations.view',              'operations',             'view'),
  ('orders.view',                  'orders',                 'view'),
  ('orders.notes.add',             'orders',                 'notes_add'),
  ('promotions.view',              'promotions',             'view'),
  ('roles.view',                   'roles',                  'view'),
  ('support_tickets.view',         'support_tickets',        'view'),
  ('technician_companies.view',    'technician_companies',   'view'),
  ('technician_kpi.view',          'technician_kpi',         'view'),
  ('technician_levels.view',       'technician_levels',      'view'),
  ('technician_progression.view',  'technician_progression', 'view'),
  ('technician_referrals.view',    'technician_referrals',   'view'),
  ('technicians.view',             'technicians',            'view'),
  ('technicians.finance.view',     'technicians',            'finance_view'),
  ('technicians.notes.view',       'technicians',            'notes_view'),
  ('technicians.notes.add',        'technicians',            'notes_add'),
  -- **بَقّة حقيقية اتلقطت بفحص كتالوج الصلاحيات نفسه أول ما اشتغل**: مسارَي الرقم القومي
  -- (`PATCH/GET /admin/technicians/:id/national-id`، ADR-0045 §4) كانوا بيطلبوا
  -- `technicians.manage` — اسم **مش موجود في الكتالوج أصلاً**. `hasPermission()` كانت بترجّع
  -- false دايمًا، يعني المسارين مقفولين على كل الأدوار للأبد (بس `super_admin` بيعدّي بالـbypass).
  -- عكس فئة S-1 بالظبط: مش انفتاح صامت، ده انقفال صامت — ومحدش شافه لأن مفيش حاجة كانت بتقارن
  -- أسماء الصلاحيات في الكود بالكتالوج. الاسمين هنا بيطابقوا نية ADR-0045: الكشف عن الرقم كامل
  -- صلاحية منفصلة عن تسجيله، والاتنين مش `action = 'view'` فمش داخلين في قاعدة الاشتقاق.
  ('technicians.national_id.manage', 'technicians',          'national_id_manage'),
  ('technicians.national_id.view',   'technicians',          'national_id_view')
ON CONFLICT (name) DO NOTHING;

-- ── ٢) اعتماديات وظيفية بين موارد مختلفة ───────────────────────────────────
-- **مفيش هنا أي منح لـ`<resource>.view` على نفس المورد عمدًا.** القاعدة دي («مين بيقدر يعدّل
-- مورد، يقدر يقراه») اتنفّذت في الكود مرة واحدة جوّه `PermissionsService.getUserPermissionNames()`
-- بدل ما تتنسخ هنا كصفوف ثابتة. الفرق مش شكلي: لو كانت صفوف، أي **دور جديد** المشغّل ينشئه من
-- واجهة الأدمن بعد كده وياخد `support_tickets.manage` هيبقى عاجز يفتح شاشة التذاكر أصلاً — فخ
-- صامت بيتكرر مع كل دور جديد. في الكود القاعدة بتسري على الأدوار الجاية زي القديمة بالظبط.
--
-- اللي تحت هو **بس** اللي القاعدة دي ماتغطّيهوش: اعتماديات بتعبر الموارد. موظف الدعم اللي بينشئ
-- طلب نيابة عن عميل (`orders.create_for_customer`) محتاج يقرا الكتالوج والمناطق والعميل والفنيين،
-- وإلا الشاشة بتفضل فاضية. الجدول ده هو القايمة الصريحة للاعتماديات دي — كل سطر مربوط بقدرة الدور
-- كان **بيستعملها فعلاً قبل الـmigration**، مش توسيع صلاحيات.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  -- مدير العمليات: بيدير الطلبات والفنيين والكتالوج — محتاج يقرا العميل صاحب الطلب،
  -- ومركز العمليات، وشركات الفنيين، والترشيحات، وملاحظات الفني/الطلب الداخلية.
  ('ops_manager',   'customers.view'),
  ('ops_manager',   'operations.view'),
  ('ops_manager',   'complaints.view'),
  ('ops_manager',   'notifications.view'),
  ('ops_manager',   'technician_companies.view'),
  ('ops_manager',   'technician_referrals.view'),
  ('ops_manager',   'technicians.notes.view'),
  ('ops_manager',   'technicians.notes.add'),
  ('ops_manager',   'orders.notes.add'),

  -- المالية: التسويات والصرف والعمولة كلها مربوطة بطلب وفني وعميل بالاسم.
  -- `technicians.finance.view` (كشف الأرباح والتسوية) للدور ده **بس** — ده جوهر شغله.
  ('finance',       'orders.view'),
  ('finance',       'customers.view'),
  ('finance',       'technicians.view'),
  ('finance',       'technicians.finance.view'),

  -- الدعم: بينشئ طلب نيابة عن عميل ويحل شكاوى — محتاج الكتالوج والمناطق والعميل والفني.
  ('support_agent', 'orders.view'),
  ('support_agent', 'orders.notes.add'),
  ('support_agent', 'customers.view'),
  ('support_agent', 'catalog.view'),
  ('support_agent', 'geo.view'),
  ('support_agent', 'technicians.view'),

  -- التوظيف: بيراجع مستندات الفنيين ويعتمدهم — محتاج ملفهم وشركاتهم وسجل الأكاديمية
  -- وملاحظاتهم الداخلية. **من غير** `technicians.finance.view`.
  ('recruiter',     'academy.view'),
  ('recruiter',     'technician_companies.view'),
  ('recruiter',     'technicians.notes.view'),
  ('recruiter',     'technicians.notes.add')
) AS grants(role_name, permission_name)
JOIN roles r ON r.name = grants.role_name AND r.deleted_at IS NULL
JOIN permissions p ON p.name = grants.permission_name
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── ٣) صلاحيتَي الرقم القومي ────────────────────────────────────────────────
-- المسارين دول كانوا مقفولين على الكل (اسم صلاحية غير موجود، شوف التعليق فوق). مين المفروض
-- يفتحهم؟ نفس اللي بيراجع أوراق الفني فعلاً — فالمنح مشتقّ من `technicians.review_documents`
-- بدل قايمة أدوار مكتوبة بالإيد، عشان يمشي على أي دور مخصّص في الإنتاج كمان.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id AND src.name = 'technicians.review_documents'
JOIN permissions target ON target.name IN ('technicians.national_id.manage', 'technicians.national_id.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;
