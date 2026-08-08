# modules/support

الشكاوى وتذاكر الدعم. جداول: complaints, complaint_messages, complaint_attachments, support_tickets (قاموس §8.2-8.4).

**الحالة: شغال (S8) — complaints بالكامل + complaint_attachments، support_tickets لسه.**

- `complaint-state-machine.ts`: نفس فلسفة `orders/order-state-machine.ts` — انتقالات مقفولة (`open→under_investigation→resolved/rejected→closed`)، أي انتقال مش معرّف يترفض.
- **`POST /complaints`**: العميل أو الفني يفتح شكوى، اختيارياً مربوطة بطلب — لو مربوطة، بيتحقق إن الفاتح فعلاً طرف في الطلب، وبيحدد الطرف التاني المُشتكى منه أوتوماتيك. بيصدر حدث `complaint.filed` (بره الـ transaction) — `notifications` بيوجّهه لدور `support_agent` عبر `notification_routing_rules` (تفاصيل في `../notifications/README.md`).
- **الرسائل**: كل طرف (عميل/فني/أدمن) يقدر يرد، بس الأدمن بس يقدر يكتب `is_internal_note` — لو عميل/فني حاول يبعتها، بتتحول لرسالة عادية تلقائياً (مش بترفض الطلب، بس بتتجاهل العلم). العميل والفني ميشوفوش الملاحظات الداخلية خالص.
- **`POST /admin/complaints/:id/resolve`**: لو فيه `compensation_cents`، التعويض بيتحوّل فعلياً لمحفظة صاحب الشكوى (عميل أو فني) جوّه نفس الـ transaction اللي بتقفل الشكوى — و الـ state machine بيمنع حل شكوى اتحلت قبل كده أصلاً، فده حماية مزدوجة ضد تعويض مكرر.
- **بَقّة حقيقية اتكشفت واتصلحت أثناء الاختبار**: مسارات `GET /complaints/:id`، `GET/POST /complaints/:id/messages` كانت مقفولة على الأدمن بالـ RBAC (`@Roles(CUSTOMER, TECHNICIAN)` بس على مستوى الكلاس)، رغم إن منطق الـ service كان أصلاً بيتعامل مع الأدمن كـ participant دايماً. يعني فريق الدعم كان مش هيقدر يقرا ولا يرد على أي شكوى. اتصلحت بـ `@Roles` على مستوى الـ method لكل endpoint، مش بس الكلاس.
- **اتعمله اختبار end-to-end فعلي شامل**: شكوى اتفتحت وربطت أوتوماتيك بالطرف التاني، الطرف المتّهم قدر يرد، طرف تالت غريب اترفض بـ 403، تعويض 20 جنيه اتحوّل فعلياً لمحفظة العميل (اتأكد من رصيده قبل وبعد)، محاولة حل الشكوى مرتين اترفضت، ملاحظة داخلية اتخبت عن العميل وظهرت للأدمن، وقفل شكوى قبل ما تتحل اترفض.
- لسه من غير: `support_tickets` (تذاكر الدعم العامة، مش مرتبطة بشكوى/طلب)، وتصنيف `severity`/التصعيد الأوتوماتيكي — دلوقتي كله `medium` ثابت، والتصنيف الدقيق مسؤولية فريق الدعم يدوياً وقت المراجعة.

## `complaint_attachments` — كانت فجوة موثّقة، اتقفلت

الجدول كان موجود فعلاً في `infra/migrations/0009_support_chat_notifications.sql` من أول يوم (فاضي) — نفس حالة `service_level_pricing`/`service_addons`. مفيش migration جديدة، بس entity/service/endpoints جداد.

- **نفس نمط `OrderMediaService` بالحرف** (`../orders/README.md`): `POST /complaints/:id/attachments` (multipart، حقل `file`، JPEG/PNG/WEBP بس، حد أقصى 10MB) و`GET /complaints/:id/attachments`. التخزين وراه نفس `StorageService` (`LocalDiskStorageService` محلياً، نفس الـ provider swap لـ S3 مستقبلاً).
- **الصلاحية**: نفس `isParticipant()` المُستخدمة أصلاً في `getForUser()` — اللي فتح الشكوى، الطرف المُشتكى منه، أو أي أدمن. أي طرف تالت غريب (فني/عميل مش طرف في الشكوى) بيترفض 403 بنفس رسالة "الشكوى دي مش بتاعتك" المُستخدمة في باقي مسارات الشكوى — مفيش منطق تفويض جديد اتضاف، استخدمنا اللي موجود.
- اتعمله اختبار حي كامل: عميل فتح شكوى (من غير طلب مربوط)، رفع صورة PNG حقيقية 1×1 (نفس fixture مستخدم في اختبارات `apps/technician-app`) — اتكتبت فعلاً على القرص، الرابط الراجع اتأكد منه بـ `curl` مباشر: `200 image/png` والبايتات طابقت الأصل بالظبط (`diff`). الأدمن قدر يشوف ويرفع مرفق كمان (participant دايماً). فني مش طرف في الشكوى اترفض 403 من `GET` و`POST` الاتنين. ملف نص عادي (`text/plain`) اترفض 400 بوضوح قبل حتى ما يوصل للتخزين.

**الصلاحيات الدقيقة اتفعّلت**: `resolve`/`reject`/`close` محتاجين صلاحية `complaints.resolve` بالتحديد الآن (`support_agent` عنده، `finance`/`recruiter` لأ) عبر `PermissionsGuard` — التفاصيل الكاملة والاختبار في `../admin/README.md`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
