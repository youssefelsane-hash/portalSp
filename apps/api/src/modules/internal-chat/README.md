# modules/internal-chat

شات داخلي بين الموظفين والفنيين — "نظام تواصل بين المدير والـworkers وبين الأدمن والـworkers" (طلب صريح من المستخدم). جداول: `internal_chat_threads`, `internal_messages` (migration `0045_internal_chat.sql`).

**الحالة: شغال، مُختبر حي بالكامل.**

## ليه جدول جديد منفصل عن `chat_threads` الموجود

`chat_threads` (موديول `chat`) عنده `customer_id UUID NOT NULL REFERENCES customer_profiles(id)` — موظفين وفنيين مالهمش `customer_profile` أصلاً، فمفيش طريقة نظيفة تستخدم الجدول ده لمحادثة موظف↔فني من غير تعديل قيد `NOT NULL`/`FK` على جدول مُختبر بالكامل ومستخدم فعلياً لشات الطلب/الدعم. جدول منفصل تماماً أخطر أقل وأوضح مفهومياً — الشات الداخلي ده مفهوم مختلف تماماً عن "شات مع عميل" (لا `is_flagged`/كشف أرقام موبايل مهم هنا، لا `closes_at` بعد اكتمال طلب، لا صلة بطلب أصلاً).

## نطاق أول نسخة (قرارات واعية، موثّقة صراحة)

- **الأزواج المسموحة**: `admin↔admin` أو `admin↔technician`. **مش** `technician↔technician` — مش مطلوب صراحة، والنطاق الأوسع محتاج قرارات هرمية إضافية (مين يقدر يكلم مين بالظبط داخل نفس المستوى) مؤجلة عمداً. `customer` ممنوع تماماً من الشات ده — عنده `support_chat` منفصل في موديول `chat`.
- **مفيش هرمية منظّمة مفروضة** (زي "الفني يقدر يكلم بس مديره المباشر"): أي أدمن يقدر يكلم أي فني، وأي فني يقدر يكلم أي أدمن. قرار مبسّط متعمّد بطلب صريح ("مش عايز أصعب الموضوع") — لو الهرمية الدقيقة اتطلبت لاحقاً، `employee_profiles.manager_user_id` الموجود من زمان جاهز يُستخدم كفلتر إضافي.
- **مفيش WebSocket** — بولينج كل 4 ثواني في `apps/admin` (نفس نمط `/support-chat`)، ومفيش حتى بولينج تلقائي في `apps/technician-app` (تحديث يدوي بس عبر `RefreshIndicator`/فتح الشاشة). كافي لحجم الاستخدام المتوقع لأداة تنسيق داخلي، مش شات لحظي بكثافة استخدام عالية.
- **مفيش صور/مرفقات** — نص بس، عكس `chat` (شات الطلب/الدعم) اللي فيه دعم صور. لو احتيج لاحقاً، نفس نمط `ChatService.sendImageMessage()` قابل للتكرار هنا بسهولة.

## التصميم

- **ترتيب ثابت للزوج مفروض على مستوى القاعدة نفسها**: `CHECK (participant_a_user_id < participant_b_user_id)` + `UNIQUE (participant_a_user_id, participant_b_user_id)` — مش بس منطق تطبيق. `InternalChatService.getOrCreateThread()` بترتّب الزوج (`.toLowerCase().sort()`) قبل أي `find`/`create`، فمفيش صف مكرر ممكن يتعمل لنفس الزوج بترتيب معكوس حتى لو حصل سباق.
- **`GET /internal-chat/contacts`**: بيرجّع مين المستخدم الحالي يقدر يبدأ معاه محادثة — أدمن يشوف كل الأدمنز التانيين + كل الفنيين، فني يشوف الأدمنز بس. مفيش صفحات (pagination) — العدد المتوقع صغير كفاية (موظفين + فنيين، مش عملاء).
- **`POST /internal-chat/threads`** (body: `peer_user_id`): get-or-create، idempotent — نداء تاني بنفس الطرفين بيرجّع نفس الخيط بالظبط.
- **`GET/POST /internal-chat/threads/:id/messages`**: نفس نمط `chat` بالظبط (`resolveParticipant` قبل أي قراءة/كتابة، 403 لو مش طرف في الخيط).
- **`@Roles(UserType.ADMIN, UserType.TECHNICIAN)`** على مستوى كل method (مش controller) — أول استخدام في المشروع لـ`@Roles` بقيمتين مع بعض، عشان الشات ده الوحيد المتاح لنوعي مستخدمين مختلفين في نفس الوقت.

## اتعمله اختبار حي كامل

- **curl مباشر ضد السيرفر الشغال**: أدمن بدأ محادثة مع أدمن تاني، idempotent (نداء تاني رجّع نفس الـ id)، رسايل اتبعتت واتقروت في الاتجاهين، فني حاول يكلم فني تاني اترفض `400` بوضوح، عميل اترفض `403` من كل الـ endpoints، فني حاول يقرا محادثة مش بتاعته اترفض `403`.
- **`apps/technician-app/test_live/internal_chat_live_test.dart`**: فني بدأ محادثة مع أدمن حقيقي، idempotent اتأكد، رسايل اتبادلت وطابقت الترتيب/المحتوى بالظبط عبر `GET .../messages`، فني تاني اترفض `403`، عميل اترفض `403` من `/contacts`، ومحاولة فني↔فني اترفضت `400`.
- **`apps/admin`, صفحة `/internal-chat` و`/internal-chat/:id`**: اتختبرت حية بـ Playwright — القايمة عرضت المحادثات الموجودة، فتح محادثة عرض الرسائل صح، الرد اتبعت وظهر فوراً، فورم "محادثة جديدة" عرض قايمة جهات الاتصال (موظفين وفنيين) واتنقل لمحادثة جديدة بنجاح.

## `apps/admin` و`apps/technician-app`

- **`apps/admin`**: صفحتين جداد (`/internal-chat` قايمة + فورم بدء محادثة من `SelectNative`، `/internal-chat/:id` شاشة الشات — نفس بنية `/support-chat` بالظبط). نفس نمط البولينج.
- **`apps/technician-app`**: `lib/features/internal_chat/` جديد بالكامل — `InternalChatRepository` (نفس نمط `ChatRepository`)، `InternalChatListScreen` (قايمة + `FloatingActionButton` يفتح `showModalBottomSheet` لاختيار جهة اتصال)، `InternalChatDetailScreen` (شات مع بولينج `Timer.periodic` كل 4 ثواني، نفس رقم `apps/admin`). زرار دخول جديد (`Icons.support_agent_outlined`, "تواصل مع الإدارة") في `AvailableOrdersScreen` جنب زرار المحفظة.

مرجع كامل: `../../../../docs/01-master-plan.md` §2.4.
