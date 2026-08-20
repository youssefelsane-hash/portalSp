# Operations (مركز العمليات)

بداية "مركز العمليات" الجديد في `apps/admin` (docs/08 §36.2 فصاعدًا) — قسم مستقل هيتوسّع مرحلة
بمرحلة (§36.3 مصفوفة قوى عاملة، §36.4 عرض حمل، §36.5 مفتّش مطابقة، §36.6 "ليه/ليه لأ"، §36.7 مراقبة
تسليم، §36.8 تايم لاين، §36.9 تنبيهات، §36.10 ذكاء تغطية، §36.11 تحكم أدمن، §36.12 بحث/فلترة، §36.13
بروفايل 360، §36.14 لغة بصرية موحّدة).

## القاعدة الحاكمة

الموديول ده **مايخترعش** منطق أهلية/تصنيف جديد — كل رقم بيرجّعه معاد استخدامه من مصدر حقيقة موجود
فعلاً في موديولات تانية:

- `dispatch_pending_count` — حالات `SEARCHING_TECHNICIAN`/`AWAITING_TECHNICIAN_RESELECTION`
  (`orders/entities/order.entity.ts`).
- `crew_shortage_open_count` — `ESCALATABLE_STATUSES` مُصدَّرة من
  `orders/crew-shortage-escalation.service.ts` (§35.5)، مش قائمة حالات مكرّرة هنا.
- `technicians_online_count` — `RealtimeSessionRegistry.onlineUserIds()` (§35.10).
- `capacity_today` (LIGHT/MEANINGFUL/HEAVY/BLOCKED) — نفس شروط `classifyTechnicianCapacity()`
  بالحرف (`technicians/technician-eligibility.sql.ts`، §34.1)، بس bulk aggregate لكل الفنيين مرة
  واحدة (استعلام واحد بـCTEs) بدل نداء منفصل لكل فني — نفس أسلوب `MatchingExplainabilityService`
  بتاع §35.8.

## بنية الموديول

موديول مستقل (نفس نمط `MatchingModule`) — بيستورد ثوابت/كيانات خام من `orders` (`OrderStatus`،
`ACTIVE_TECHNICIAN_ORDER_STATUSES`، `ENGAGED_TECHNICIAN_ORDER_STATUSES`، `ESCALATABLE_STATUSES`) مش
`OrdersModule` نفسه، عشان يتجنّب أي دورة استيراد.

- `admin-operations-overview.service.ts` — `AdminOperationsOverviewService.getOverview({categoryId?})`.
- `admin-operations.controller.ts` — `GET /admin/operations/overview?category_id=...`،
  `@Roles(UserType.ADMIN)` بس (بلا صلاحية دقيقة مخصوصة، نفس مستوى `/orders`).
- `dto/operations-overview-query.dto.ts` — `category_id` اختياري (UUID).

## قرار عمل متعمّد: فلتر فئة بس (مش منطقة) في §36.2

فلتر المنطقة محتاج UI اختيار مدينة→منطقة (cascading selector) مش موجود جاهز في الصفحة دي حاليًا —
أنسب لـ§36.10 (ذكاء تغطية القوى العاملة، فئة+منطقة صراحة) بدل ما يتحشر هنا في "بنية أساسية" المفروض
تفضل بسيطة.

## اختبارات

`admin-operations-overview.spec.ts` — اختبار حي كامل ضد Postgres حقيقي (8/8): dispatch pending،
crew shortage مفتوح/مقفول، فلتر الفئة، وكل الـ4 tiers بسيناريوهات حقيقية.

## تحقق حي إضافي (مش jest بس)

اتعمل تحقق كامل عبر متصفح حقيقي (Playwright) ضد `apps/api`/`apps/admin` dev servers شغالين فعليًا:
تسجيل دخول حقيقي بحساب أدمن بلا role (مُعفى من MFA — راجع `auth/mfa-policy.service.ts`)، فتح
`/operations`، وأرقام حقيقية من الداتابيز ظهرت صح. **فجوة موثّقة صراحة**: مفيش بنية Playwright
تلقائية دائمة مثبّتة في المشروع (لا config، لا dependency، لا specs) رغم إشارة `apps/admin/README.md`
لها — التحقق ده كان سكريبت مؤقت غير محفوظ. بناء بنية اختبار حقيقية دائمة خارج نطاق §36.2.
