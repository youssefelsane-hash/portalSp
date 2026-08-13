# favorites — المفضّلة (Favorites)

كانت مؤجّلة عمدًا كـ`backlog` منفصل (`docs/10-integration-completion-tracker.md` بند 36 —
"مش موجودة خالص"). أبسط شكل ممكن يخدم القيمة المطلوبة: العميل يحفظ فني اشتغل معاه قبل كده
عشان يلاقيه بسهولة تاني (إعادة حجز أسرع)، بدل ما يدوّر عليه من الأول في نتائج البحث.

## الجدول

`customer_favorite_technicians` (`migration 0078`): `id`, `customer_user_id` (→ `users.id`),
`technician_id` (→ `technician_profiles.id`), `created_at`, `updated_at`. `UNIQUE
(customer_user_id, technician_id)`. **مفيش `deleted_at` عمدًا** — إلغاء التفضيل = حذف الصف
فعليًا (نفس نمط `order_team_members` بالظبط، جدول عضوية بسيط)، مش soft-delete لتاريخ محتاجينوش.

## الـ endpoints (`/me/favorites/technicians`, عميل بس)

- `GET /me/favorites/technicians` — القايمة كاملة (ملخّص فني: اسم/صورة/تقييم/عدد طلبات مكتملة).
- `GET /me/favorites/technicians/:id/status` — `{is_favorited: boolean}` بس، مفيش استدعاء القايمة
  كاملة كل ما العميل يفتح بروفايل فني.
- `POST /me/favorites/technicians/:id` — تفضيل (idempotent — تفضيل فني مفضّل بالفعل no-op، مش
  خطأ). `404 VAL_001` لو الفني مش موجود.
- `DELETE /me/favorites/technicians/:id` — إلغاء تفضيل (idempotent — إلغاء فني مش مفضّل أصلاً
  no-op بصمت، مفيش داعي نرفضه).

**ملحوظة تصميم مهمة**: التلات endpoints دول بيرجّعوا `{is_favorited: boolean}` بـ`200`/`201`
عادي — **عمدًا مفيش `204 No Content`**. `apps/customer-app`'s `apiRequest()` بيعمل
`jsonDecode()` على الـbody بلا شرط لأي رد، فـ`204` بجسم فاضي كان هيفشل بـ`FormatException` وقت
الاستدعاء الفعلي من التطبيق — بَقّة حقيقية اتلقطت واتصلحت أثناء البناء (مكانش فيه أي endpoint
تاني في المشروع بيستخدم `204` أصلاً، فمكانتش الفجوة ظاهرة قبل كده). رجوع الحالة الجديدة كمان
مفيد عمليًا: الواجهة بتاخد تأكيد فوري بدل ما تفترض النتيجة.

## اختبار حي

عميل حقيقي جديد (تسجيل عبر OTP) + فني معتمد حقيقي موجود بالفعل:
`GET status` (false) → `POST` (`{is_favorited:true}`, `201`) → `GET list` (فني واحد بكل
الحقول صح) → `POST` تاني (idempotent، نفس الرد) → `DELETE` (`{is_favorited:false}`, `200`) →
`GET list` (فاضية) → `POST` على UUID عشوائي (`404 VAL_001`). كل الحالات طابقت المتوقع بالحرف.
`tsc --noEmit`/`nest build`/`jest` (44 اختبار) عدّوا كلهم. بيانات الاختبار (مستخدم تجريبي)
اتعملها soft-delete بعد التأكيد.

## واجهة العميل (`apps/customer-app`)

`features/favorites/` (`models.dart`, `favorites_repository.dart`, `favorites_screen.dart`) —
قايمة + إزالة مباشرة من الكارت. أيقونة قلب في `AppBar` بتاع `TechnicianProfileScreen` (تفضيل/
إلغاء مباشر من صفحة البروفايل، بتفضل مخفية لحد ما نجيب الحالة الحقيقية من الباك-إند — مفيش
افتراض `false` مؤقت ممكن يوهم العميل). دخول من `AccountScreen` (نفس نمط باقي أقسام الحساب
الموحّد). `flutter analyze` عدّى بلا أي مشكلة جديدة (27 info موجودة من قبل، صفر منهم في كود
المفضّلة).

## نطاق مؤجّل عمدًا

مفيش "فني مقترح تلقائي" ولا ترتيب حسب أكتر تفاعل — تفضيل صريح بس من العميل، زي ما اتطلب.
مفيش مفضّلة لخدمات (services) — الطلب الأصلي (`docs/10` بند 36) عام "Favorites" بلا تفصيل،
واخترنا فنيين لأنها القيمة الأوضح في ماركت بلاس خدمات منزلية (إعادة حجز فني موثوق)؛ لو المالك
عايز مفضّلة خدمات كمان لاحقًا، نفس النمط (جدول عضوية + 3 endpoints) قابل للتكرار بسهولة.
