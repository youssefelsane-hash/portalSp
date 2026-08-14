# modules/notifications

الإشعارات وأجهزة المستخدمين. جداول: notifications, user_devices (قاموس §9.3-9.4).

**الحالة: شغال (دعم بنية تحتية عبر الموديولات).**

- **الأجهزة**: `POST /devices` بيسجّل/يحدّث جهاز بـ `device_id` فريد — لو الجهاز ده كان مسجّل قبل كده لمستخدم تاني (خروج وتسجيل دخول بحساب مختلف على نفس الموبايل)، بتتنقل ملكيته للمستخدم الحالي أوتوماتيك (اتعمله اختبار فعلي). `DELETE /devices/:deviceId` بيلغي تفعيل جهاز بتاعك بس — جهاز مش موجود أو مش بتاعك بيرجّع نفس رسالة "غير موجود" (مفيش تسريب معلومة إن الجهاز موجود لمستخدم تاني).
- **بوابة الإرسال قابلة للتبديل**: `NotificationDispatcher` (`common/notifications/`) نفس فلسفة `StorageService`/`PaymentGateway`. `CompositeNotificationDispatcher` (الافتراضي دلوقتي) بيوجّه كل قناة لبوابتها الحقيقية المستقلة — `in_app` لسه دايماً عبر `LogOnlyNotificationDispatcher` (مفيش بوابة خارجية أصلاً، بيتخزن في القاعدة نفسها)، والباقي:

  | القناة | البوابة الحقيقية | env vars |
  |---|---|---|
  | `push` | `FcmPushDispatcher` (Firebase Cloud Messaging، `firebase-admin`) | `FIREBASE_SERVICE_ACCOUNT_JSON` |
  | `sms` | `TwilioSmsDispatcher` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM_NUMBER` |
  | `whatsapp` | `TwilioWhatsAppDispatcher` (نفس حساب Twilio، رقم WhatsApp منفصل) | + `TWILIO_WHATSAPP_FROM_NUMBER` |
  | `email` | `SmtpEmailDispatcher` (`nodemailer`، أي بوابة SMTP — SendGrid/Mailgun/SES/Gmail) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` |

  كل قناة `isConfigured` مستقلة عن الباقي — لو ناقص أي env var لقناة معيّنة، `CompositeNotificationDispatcher` بيرجّعها تلقائياً لـ`LogOnlyNotificationDispatcher` (نفس السلوك القديم بالظبط: تسجيل في اللوج، "delivered" لو فيه target فعلاً، فشل واضح لو مفيش) — تفعيل قناة واحدة (push مثلاً) من غير الباقي شغال عادي، مفيش تبعية بين القنوات. تفاصيل الحصول على كل قيمة ومكانها بالظبط: `docs/03-external-integrations.md`.
  - **اتأكد حياً**: `in_app` لسه شغال زي ما هو (صفر رجعة، اتأكد بطلب حقيقي ولّد 3 إشعارات in_app متتالية بنجاح). مسار `complaint.filed → ops_manager` (بقناتين `in_app`+`email` عبر `notification_routing_rules`) اتأكد إنه لسه بيعدّي صح عبر `CompositeNotificationDispatcher` الجديد من غير أي كسر — شكوى حقيقية اتفتحت وولّدت الإشعارين المتوقعين بالضبط.
- **`notify()`**: بيسجّل صف `notifications` دايماً حتى لو فشل الإرسال الفعلي — أي استثناء من البوابة بيتلقّف ويتسجّل كـ `delivery_status=failed` مع `failure_reason` واضح، ومبيفشلش العملية اللي استدعته (طلب اتقبل، مثلاً، لازم ينجح حتى لو الإشعار فشل).
- **`notifyMultiChannel()`**: بيبعت نفس الحدث على أكتر من قناة، كل قناة صف مستقل بمصير مستقل.
- **الاستماع للأحداث** (`listeners/`): بدون أي استدعاء مباشر من الموديولات التانية — كل حاجة عبر `EventEmitter2`:
  - `user.registered` → رسالة ترحيب (`in_app`).
  - `order.created` → إشعار للعميل بس.
  - `order.accepted` → إشعار للعميل والفني الاتنين مع بعض.
  - `order.status_changed` (حدث جديد اتضاف في `orders.service.ts` لكل انتقال حالة فني أو إلغاء عميل، وبقى بيتصدر كمان من `admin-orders.service.ts` عند إلغاء إداري) → إشعار العميل عند `technician_on_way`/`technician_arrived`/`in_progress`/`work_completed`، إشعار الفني عند `cancelled_by_customer`، وإشعار الطرفين الاتنين مع سبب الإلغاء عند `cancelled_by_system` (إلغاء من الأدمن).
  - `order.reassigned` (حدث جديد، `admin-orders.service.ts`) → إشعار الفني اللي الأدمن عيّنله الطلب مباشرة.
  - `technician.verification_changed` (حدث جديد، `admin-technicians.service.ts`) → إشعار الفني بقرار الاعتماد/الرفض (وسبب الرفض بالظبط لو اترفض).
  - `rating.submitted` (حدث جديد، `ratings.service.ts createRating()` — كانت فجوة موثّقة، اتقفلت) → إشعار مباشر للطرف اللي اتقيّم (عميل أو فني، أي اتجاه) بعدد النجوم، مستقل تماماً عن `rating.low_rating_submitted` تحت (ده بيتوجّه لـ`support_agent` بس لو التقييم منخفض).
- **`GET /notifications`**: صفحات + فلتر `unread_only`. `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.
- **اتعمله اختبار end-to-end فعلي شامل** على قاعدة بيانات حقيقية وسيرفر شغال: تسجيل عميل → إشعار ترحيب اتسجّل تلقائي وظهر في القايمة. تسجيل جهاز بـ fcm_token وجهاز من غير token (الحالة الواقعية إن الكلاينت لسه ملحقش ياخد التوكن). دورة طلب كاملة (إنشاء → قبول → في الطريق → وصل → بدأ → خلص) وكل خطوة ولّدت إشعار العميل الصح بالترتيب الصح، وقبول الطلب ولّد إشعار للفني كمان. إلغاء العميل لطلب مقبول ولّد إشعار "العميل لغى الطلب" للفني. `mark-all-read` رجّع العدد الصح وصفّر `unread_count`. جهاز مش موجود ومحاولة إلغاء جهاز مستخدم تاني الاتنين رجّعوا نفس رسالة "غير موجود". تسجيل نفس `device_id` تحت مستخدم تاني نقل الملكية فعلياً (اتأكد من `user_id` في القاعدة). قناة `push` من غير أي جهاز فعّال برجع `failed` مع سبب واضح، ومع جهاز عنده `fcm_token` برجع `sent` — الاتنين اتأكد منهم مباشرة عبر `NotificationsService.notify()` (مش بس عبر endpoint، عشان مفيش مسار HTTP بيبعت push مباشرة دلوقتي).
- ~~لسه من غير: قنوات sms/whatsapp بترجع targets فعلية بس من غير بوابة إرسال حقيقية~~ — **اتقفلت**، تفاصيل فوق.

## توجيه الإشعارات الداخلية حسب الدور (`notification_routing_rules`) — جديد (S10، نقطة 10)

الفجوة كانت إن كل الإشعارات الموجودة فوق بتوصل لصاحب العملية (العميل/الفني) بس — مفيش أي إشعار استباقي للأدمن نفسه ("شكوى جديدة محتاجة حد يراجعها"، "صرف محتاج موافقة"). دلوقتي فيه طبقة توجيه عامة قابلة للتعديل بالكامل من غير كود:

- **`notification_routing_rules`** (`infra/migrations/0030`، 2 قاعدة مزروعة): `event_type` (اسم حر، بيتطابق مع اسم حدث `EventEmitter2`) → `role_name` → `channels` (مصفوفة قنوات) → `is_active`. **مفتاح فريد `(event_type, role_name)`** — نفس الحدث ممكن يتوجّه لأكتر من دور بقواعد منفصلة، كل واحدة بقنواتها الخاصة.
- **`NotificationRoutingService.routeToRole(eventType, payload)`**: بيتفحص القواعد الفعّالة وقت الحدث نفسه (مش subscription متخزّنة) — بيلاقي كل الأدمن (مش محظورين) عندهم الدور ده عبر `user_roles`، وبيبعتلهم `notifyMultiChannel()`. **مبيرميش أبداً** — فشل التوجيه مايكسرش العملية الحقيقية اللي ولّدت الحدث (نفس فلسفة `notify()`/`AuditLogService.record()`).
- **`GET/POST/PATCH/DELETE /admin/notification-routing-rules`**: `GET` مفتوح لأي أدمن، الباقي محتاج `notifications.manage` (`infra/migrations/0031` — `super_admin` بس). إنشاء قاعدة بدور مش موجود أو قاعدة مكرّرة (نفس `event_type`+`role_name`) بيترفض بوضوح.
- **2 حدث حقيقي جديد اتوصّلوا** (كانوا معدومين تماماً — `support`/`payments` ما كانوش بيصدروا أي حدث أصلاً):
  - `complaint.filed` (`support/support.service.ts fileComplaint()`) → مزروعة على `support_agent`.
  - `payout.requires_review` (`payments/payouts.service.ts requestPayout()`, بس لو الصرف مش auto-approved) → مزروعة على `finance`.
- **اتعمله اختبار end-to-end فعلي شامل**: عميل فتح شكوى → `support_agent` استلم إشعار `in_app` فوراً بعنوان ووصف الشكوى بالظبط، و`super_admin` (مالوش الدور ده) ما استلمش حاجة. فني طلب صرف 1500 جنيه (فوق حد الموافقة التلقائية 1000) → `finance` استلم إشعار بالمبلغ والرابط الصح. تعطيل قاعدة `complaint.filed→support_agent` عبر الـ API **من غير أي restart** أوقف الإشعارات فوراً (شكوى تانية اتفتحت وعدد إشعارات support_agent فضل زي ما هو)، وإعادة تفعيلها رجّعت الشغل. إضافة قاعدة تانية لنفس الحدث لدور تاني (`ops_manager`) بقناتين (`in_app`+`email`) اشتغلت بالتوازي مع القاعدة الأولى — `ops_manager` استلم صفين مستقلين، واحد `sent` (`in_app`) وواحد `failed` بسبب واضح (`email`، مفيش بوابة حقيقية لسه — نفس صراحة باقي القنوات مش المُوصّلة). `finance` (مالوش `notifications.manage`) اترفض من إنشاء قاعدة لكن قدر يشوف القائمة. قاعدة مكرّرة ودور غير موجود وقناة غير صحيحة (`carrier_pigeon`) اترفضوا كلهم بوضوح.
- **واجهة `apps/admin` (`/notification-routing`) — كانت فجوة موثّقة، اتقفلت**: شاشة قايمة + إنشاء (نوع الحدث نص حر مع `datalist` بالأحداث المعروفة الستة، الدور من `GET /admin/roles` الموجود من زمان، القنوات checkboxes) + تبديل تفعيل/تعطيل + حذف بتأكيد. مفيش أي تعديل باك-إند — الأربع endpoints والـ`/admin/roles` كانوا موجودين ومختبرين من زمان من غير أي شاشة. **اتعمله اختبار حي كامل عبر Playwright**: قاعدة جديدة (`test.live_event → support_agent`, قناة SMS) اتعملت وظهرت، تعطيلها نجح وظهر البادچ "معطّلة"، حذفها رجّع عدد الصفوف لأصله — اتأكد الرقم مباشرة من `notification_routing_rules` في الـ DB. ملحوظة توثيقية: `GET /admin/roles` بيرجّع صف `Role` الخام (camelCase — `displayName`/`isSystem`) من غير DTO mapper، عكس أغلب الـ endpoints التانية اللي بترجع snake_case صريح — الشاشة بتتعامل معاه على أساس ده.

## `rating.submitted` — إشعار مباشر لصاحب التقييم — كانت فجوة موثّقة، اتقفلت

خلاف كل الأمثلة فوق (توجيه لدور إداري)، ده إشعار **مباشر لشخص محدد** — مش عبر `notification_routing_rules`، بنفس نمط `order.accepted`/`order.status_changed` (استدعاء `NotificationsService.notify()` مباشر من الـ listener).

- بيتصدر من `ratings.service.ts createRating()` — نقطة الدخول الوحيدة لأي تقييم (عميل←فني أو فني←عميل)، فمفيش تكرار كود بين الاتجاهين.
- `RatingSubmittedNotificationListener` بيحدد `deepLink` حسب `ratingType`: `/technician/orders/:id` لو الفني هو اللي اتقيّم، `/orders/:id` لو العميل.
- اتعمله اختبار حي على 3 طلبات حقيقية `completed` من غير تقييم سابق: عميل قيّم فني 5 نجوم → الفني استلم إشعار `rating_received` فوراً بالنص والرابط الصح. عميل قيّم فني تاني 1 نجمة → الفني استلم `rating_received` **و** `support_agent` استلم `low_rating_submitted` بالتوازي (الحدثين مستقلين، مش بديل عن بعض). فني قيّم عميل 5 نجوم → العميل استلم إشعار بالرابط الصح (`/orders/:id` مش `/technician/...`).

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
- **3 أحداث حساسة إضافية اتوصّلوا (`infra/migrations/0036`) — كانت فجوة موثّقة، اتقفلت جزئياً**:
  - `payment.cash_collected` (`payments.service.ts collectCash()`، حدث جديد) → مزروعة على `finance`. اتعمله اختبار حي: طلب تجريبي `work_completed`، فني حصّل كاش عليه (250 جنيه)، الاتنين مستخدمين عندهم دور `finance` استلموا إشعار مستقل بالمبلغ الصح ورقم الطلب.
  - `payout.completed` (`payouts.service.ts adminComplete()`، حدث جديد) → مزروعة على `super_admin` (مش `finance` — الأدمن اللي بيقفل الصرف أصلاً من `finance` عادةً، فده إشعار رقابي لإدارة أعلى مش تكرار). اتعمله اختبار حي: فني طلب صرف 200 جنيه (اتوافق عليه أوتوماتيك تحت الحد)، أدمن قفله، الاتنين `super_admin` استلموا إشعار بالمبلغ الصافي.
  - `rating.low_rating_submitted` (`ratings.service.ts rateAsCustomer()`، حدث جديد، بس لما `overall_rating <= 2` من 5) → مزروعة على `support_agent`. **عتبة 2/5 قرار تشغيلي معقول مني، مش رقم من القاموس** (القاموس مالوش عتبة محددة لـ"تقييم منخفض") — موثّق صراحة كقرار، مش مُختلَق كحقيقة. اتعمله اختبار حي: تقييم 1/5 مع تعليق ولّد إشعار لـ`support_agent` بالتعليق بالظبط، تقييم 4/5 بعده **ماولّدش** أي إشعار (اتأكد بعدّ الصفوف قبل/بعد) — العتبة شغالة صح.
  - الثلاثة بيتبعوا بالظبط نفس نمط `complaint.filed`/`payout.requires_review` (`try/catch` حوالين `routeToRole()`، فشل التوجيه مايكسرش العملية الحقيقية).

- **`referral.reward_earned`**: `ReferralRewardNotificationListener` (نفس نمط `welcome-notification.listener.ts` — إشعار مباشر لشخص، مش عبر `notification_routing_rules`) بيبعت للمُرشِّح لما يصدره `ReferralsService.issueReward()` (موديول `referrals`، تفاصيل كاملة `../referrals/README.md`). اتعمله اختبار حي: مُرشِّح وصل لـ10 ترشيحات مكتملة → استلم إشعار `in_app` فعلي بنص الكود والقيمة، ظهر في `GET /notifications` بتاعه فوراً.

- **`order.technician_cancelled`**: `TechnicianCancellationNotificationListener` جديد — سياسة إلغاء الفني (`docs/10`). حدث مخصوص `TECHNICIAN_ORDER_CANCELLED_EVENT` (مش `ORDER_STATUS_CHANGED_EVENT` العام، لأن الحالة الجديدة بعد الإلغاء — `searching_technician`/`awaiting_technician_reselection` — مش مميّزة كفاية لوحدها). العميل بياخد إشعار **متعدد القنوات** (`notifyMultiChannel([IN_APP, PUSH])` — "عالي الأولوية" بمعنى المشروع: مش in_app بس) بسبب آمن للعميل + deep link يفرّق بين "بندوّرلك تلقائي" و"اختار بديل بنفسك". الأدمن بياخد نسخة عبر `NotificationRoutingService.routeToRole()` الموجود أصلاً (قاعدة افتراضية جديدة `order.technician_cancelled → ops_manager`، migration 0071 — نفس نمط `order.emergency_created`). اتعمله اختبار حي: PUSH فشل بأمان (مفيش جهاز مسجّل للعميل التجريبي) وIN_APP نجح — الاتنين مسجّلين في `notifications` بحالة `delivery_status` مختلفة، مش استثناء يكسر الطلب. أدمن `ops_manager` استلم إشعار التوجيه فعليًا (اتنين مستخدمين مختلفين استلموه). تفاصيل كاملة في `../orders/README.md` § سياسة إلغاء الفني.

## تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) — ✅ خلص

كانت مؤجّلة عمدًا كـ`backlog` منفصل. مستوى القناة بس (push/sms/whatsapp/email)، مش لكل
`notification_type` — نفس نطاق الطلب الأصلي بالحرف.

- `user_notification_preferences` (`migration 0080`): `(user_id, channel)` فريد، `is_enabled`
  افتراضي `true`. **غياب الصف = مفعّل افتراضيًا** — مفيش سطر بيتخزّن لكل مستخدم لكل قناة من
  أول تسجيل، بس لما المستخدم فعليًا يغيّر تفضيله. `in_app` مستثناة عمدًا من `PREFERENCE_ELIGIBLE_CHANNELS`
  — هي صندوق الإشعارات نفسه جوّه التطبيق، مفيش معنى تعطيلها.
- `GET /me/notification-preferences` (كل القنوات الأربعة بحالتها الحالية)، `PATCH
  /me/notification-preferences/:channel` (`{is_enabled}`) — رفض واضح `400 VAL_001` لمحاولة
  تعديل `in_app`.
- **الفرض الفعلي**: `NotificationsService.notify()` بيسجّل صف `notifications` دايمًا (سجل دايم
  في صندوق الإشعارات حتى لو القناة الفعلية معطّلة)، بس لو القناة (غير `in_app`) معطّلة من
  تفضيلات المستخدم، **مفيش أي نداء لـ`dispatcher.dispatch()` أصلاً** — الصف بيتسجّل `failed`
  بسبب واضح ("المستخدم عطّل القناة دي من تفضيلاته") فورًا، مش محاولة إرسال حقيقية بتتضيّع.
- **اتعمله اختبار حي كامل**: `curl` (تعطيل/تفعيل `push` لعميل حقيقي، رفض `in_app`) + سكريبت
  `NestFactory.createApplicationContext` مباشر بيستدعي `NotificationsService.notify()` نفسها
  مرتين لنفس المستخدم — مرة والقناة معطّلة (اترجع `failed` بسبب التعطيل فورًا، **من غير** ما
  يوصل لـ`resolveTargets()`/`dispatcher` خالص) ومرة بعد التفعيل (اترجع `failed` بسبب مختلف
  تمامًا — "لا يوجد جهاز/بريد/رقم مسجّل" — يعني وصل فعليًا للـdispatcher المرة دي، الفرق ده
  هو الدليل إن الفرض شغال صح مش مصادفة). بيانات الاختبار اترجعت لحالتها الأصلية بعد التأكيد.
- `apps/customer-app`: `NotificationPreferencesScreen` جديدة (`features/notifications/`) —
  `SwitchListTile` لكل قناة، مدخل من أيقونة ⚙️ في `AppBar` بتاع `NotificationsScreen`.
  `flutter analyze` عدّى بلا أي مشكلة جديدة.
- **نطاق مؤجّل عمدًا**: مفيش تفضيل لكل `notification_type` (زي "عطّلي إشعارات التسويق بس سيبي
  التشغيلية") — الطلب الأصلي كان مستوى القناة بس. `apps/technician-app` لسه من غيره — نفس
  الـendpoints جاهزة، مجرد شاشة مطابقة لو المالك عايزها لاحقًا.

## محرك إشعارات الأولوية (ADR-0012، docs/08 §15) — Phase 1 خلص (2026-08-13)

طلب صريح جديد من المالك: أربع مستويات أولوية للإشعارات (`critical_offer`/`action_required`/
`scheduled_job`/`informational`) بتكرار مُدار بالكامل من الباك-إند — لو التطبيق اتقفل أو اتمسح
من الذاكرة، منطق التذكير ميضيعش لأنه أصلاً مش عايش على الجهاز. التصميم الكامل + البدائل اللي
اترفضت في `../../../../docs/adr/0012-notification-engine.md`.

**Migration `0087_notification_engine.sql`**: جدولين جداد —
- `notification_type_configs` — إعداد أولوية/صوت/قناة/actionable لكل `notification_type`،
  صفر hardcode. كل نوع موجود بالفعل في الكود اتزرع بـ`priority_tier='informational'` افتراضيًا
  (قرار آمن متعمّد — مفيش نوع موجود يتحول تلقائيًا لسلوك جديد بدون قرار أدمن صريح). `order_quote_pending_approval`
  الجديد (تحت) اتزرع مباشرة كـ`action_required`.
- `notification_workflows` — state machine عام لـ`action_required`/`scheduled_job` (مش
  `critical_offer` — ده تحسين UX فوق `order_assignments`/`order_assistant_offers` الموجودين
  أصلاً، مش كيان جديد، لسه مؤجّل). الحقول بالحرف زي ما المالك طلبهم: `event_type`(=`notification_type`),
  `priority`(`notification_type_configs.priority_tier`), `requires_action`, `action_type`,
  `entity_id`, `acknowledged_at`, `resolved_at`, `next_reminder_at`, `reminder_count`, `expires_at`.
- `notifications.workflow_id` (عمود إضافي) — كل صف تسليم فعلي (أول إرسال + أي تذكير) بيتربط
  بالـworkflow اللي ولّده، تتبّع كامل من غير تكرار بيانات.

**`NotificationWorkflowService`** (`create`/`resolve`/`acknowledge`/`acknowledgeById`) —
`resolve()`/`acknowledge()` الاتنين idempotent وآمنين 100% (safe no-op لو مفيش workflow مفتوح
مطابق)، نفس فلسفة `NotificationRoutingService.routeToRole()` اللي مابترميش استثناء أبدًا —
استدعاءهم من نقطة اكتمال فعل موجودة (زي `order-status-notification.listener.ts`) ميكسرش
العملية الأساسية لو حصل خطأ غير متوقع.

**`NotificationWorkflowReminderService` — الـsweep الدوري، مش BullMQ**: قرار معماري متعمّد
موثّق بالتفصيل في الـADR — `action_required`/`scheduled_job` ممكن يمتدوا لساعات/أيام، فاحتمالية
التصادم مع بَقّة انقطاع Redis طويل الموثّقة في `../technicians/README.md` أعلى بكتير من مهلة
دقايق زي `matching-rounds`. نفس نمط `../orders/order-auto-cancel.service.ts` بالحرف (`setInterval`
كل دقيقة، `pessimistic_write` لكل صف على حدة، إعادة تقييم من Postgres مباشرة كل مرة). بيحترم
`notification_engine.quiet_hours_start`/`_end` (إعدادات جديدة، UTC HH:MM) — تذكير مستحق جوّه
ساعات الهدوء بيتأجل (مش يتلغى) لأول لحظة بعدها، `reminder_count` مايتزودش في جولة التأجيل دي.

**أول استخدام حقيقي — موافقة عرض السعر (`awaiting_quote_approval`)**: `order-status-notification.listener.ts`
بقى بيعمل `NotificationWorkflowService.create()` (قبل الإرسال الأول، عشان الإشعار الأول برضه
يترتبط بـ`workflow_id`) لما الطلب يدخل `awaiting_quote_approval`، ويحله (`resolve('order', orderId,
'approve_quote')`) لما الطلب يخرج منها لأي وجهة (موافقة، رفض، أو حتى إلغاء العميل للطلب بالكامل).

**اتأكد حي بالكامل عبر `curl` ضد الباك-إند الحقيقي** (عميل/فنيين حقيقيين، دورة طلب كاملة):
- إنشاء workflow لحظة `awaiting_quote_approval` — `next_reminder_at` = الآن + الإعداد (60 دقيقة
  افتراضيًا)، `max_reminders`=24 (snapshot من الإعداد وقت الإنشاء)، الإشعار الأول مرتبط `workflow_id` صح.
  موافقة العميل → `resolved_at` بيتحدد فورًا، `next_reminder_at` بيترجع `NULL`.
- **الـsweep الحي نفسه (السيرفر شغال، مش استدعاء مباشر)**: `next_reminder_at` اتحط في الماضي
  يدويًا → **أول محاولة صادفت ساعات الهدوء الفعلية (كانت ~22:2x UTC وقت الاختبار، جوّه
  الافتراضي 22:00-08:00) فأجّلت التذكير لـ08:00 صح** (تأكيد حي إن قيد ساعات الهدوء شغال فعليًا،
  مش نظري) — `reminder_count` فضل صفر زي المتوقع. بعد تضييق ساعات الهدوء مؤقتًا لنطاق برّه
  الوقت الحالي، نفس الـworkflow اتبعتله تذكير حقيقي بعد ~دقيقة ونص (دورة الـsweep 60 ثانية):
  `reminder_count` بقى 1، `next_reminder_at` اتحرك +60 دقيقة بالظبط، صف `notifications` تاني
  اتسجّل مرتبط بنفس `workflow_id`. الإعدادات اترجعت لقيمها الافتراضية بعد التأكيد.
- `tsc --noEmit`/`nest build`/`jest` الثلاثة عدّوا نضيف (88 اختبار، 10 منهم جداد لـ`quiet-hours.util`
  — نطاق منتصف الليل، حدود شاملة/غير شاملة، نطاق صفري).

**نطاق Phase 1 بس — كان متبقٍ صراحة، `scheduled_job` اتقفل تحت**: باقي حالات `action_required`
(اختيار فني بديل، دفع معلّق، رفع مستند، رد الدعم)، `critical_offer` actionable push (أزرار
قبول/رفض من الإشعار نفسه — محتاج تعديل `fcm-push-dispatcher.service.ts` + جهاز حقيقي للاختبار)،
واجهة أدمن لـ`notification_type_configs` (دلوقتي عبر `psql`/migration بس) — لسه مؤجّلين.

## `scheduled_job` — تذكيرات ذكية للشغل المستقبلي المؤكَّد (migration `0089`، 2026-08-13)

مختلف جوهريًا عن `action_required`: مش فاصل ثابت متكرر (كل ساعة لحد ما يتحل)، سلسلة **checkpoints**
مبنية على الموعد المستهدف نفسه (`notification_workflows.target_at`، عمود جديد) — فورًا (وقت
الإنشاء، مش تذكير سويب)، بعدها لو لسه ما اتفتحش: بعد N دقيقة (افتراضي 60)، صبح اليوم اللي قبل
الموعد (افتراضي 8 صباحًا UTC)، وقبل الموعد بفترة أخيرة (افتراضي ساعتين) — كل قيمة إعداد قابل
للتعديل من الأدمن (`notification_engine.scheduled_job_*`). وبيوقف **بمجرد ما يتفتح**
(`acknowledged_at`، مش `resolved_at`) — مش محتاج "فعل" فعلي زي `action_required`، بس ده بس لو
`requires_acknowledgment` مفعّلة لنوع الإشعار (قابلة للتعديل — تمامًا زي ما المالك طلب: "هل
`scheduled_job` محتاج acknowledgment أصلًا").

**`computeScheduledJobCheckpoints()`** (`scheduled-job-checkpoints.util.ts`، دالة صافية زي
`quiet-hours.util.ts` بالحرف، 4 اختبارات) — بترجّع الـcheckpoints المرشّحة، بتفلتر تلقائيًا أي
checkpoint برّه النطاق `(created_at, target_at)`: موعد قريب جدًا يعني checkpoints أقل (مش تراكم
تذكيرات فات ميعادها)، موعد بعيد يعني الأربعة موجودين. بتتحسب **من جديد في كل sweep** (مش snapshot
وقت الإنشاء) — تغيير الإعداد بيأثر فورًا على workflows الشغالة، نفس فلسفة `SettingsService` في كل
مكان تاني.

**`NotificationWorkflowReminderService.processOne()`** بقى بيفرّق حسب `notification_type_configs.
priority_tier` (بيتقرا لأول مرة فعليًا — كان جدول موجود من Phase 1 بلا أي قارئ): `scheduled_job`
→ فحص `acknowledged_at` الأول، بعدين checkpoints؛ أي حاجة تانية → نفس منطق الفاصل الثابت زي ما هو
(صفر تغيير سلوكي لـ`action_required`).

**التوصيل الحقيقي**: `order-accepted-notification.listener.ts` — `OrderAcceptedEvent` اتوسّع بحقل
`scheduledAt` جديد (`matching.service.ts`'s `accept()` بيمرره من `order.scheduledAt`). لو موجود
(موعد مستقبلي، مش ASAP)، الفني ياخد `order_assigned_scheduled` (نوع جديد، `scheduled_job`) بدل
`order_assigned` العادي (صفر تغيير سلوكي لطلبات ASAP). الـworkflow بيتحل (`resolve()`، الدالة
اتوسّعت بفلتر `notificationType` اختياري جديد) لما الطلب يخرج من `accepted` لأي وجهة (بدأ الشغل
فعليًا، اتلغى، إلخ) — مالوش معنى يفضل يذكّر بموعد اتلغى أو بدأ بالفعل.

**اتأكد حي بالكامل عبر `curl` ضد الباك-إند الحقيقي** (عميل/فني حقيقيين، طلب فعلي بـ`scheduled_at`
بعد 6 دقايق، تضييق `scheduled_job_reminder_after_minutes`/`_pre_appointment_minutes` مؤقتًا
لدقيقة بس + تعطيل ساعات الهدوء مؤقتًا عشان اختبار سريع):
- الفني قبل الطلب → `notification_workflows` جديد فعليًا: `target_at`=`scheduled_at` بالظبط،
  `expires_at`=نفس القيمة، `next_reminder_at`=أول checkpoint (created_at+1 دقيقة، الـ"يوم اللي
  قبله" اتفلتر صح لأن الموعد قريب جدًا). الإشعار الأول اترتبط بـ`workflow_id` صح.
  **`order_assigned` العادي (ASAP) فضل زي ما هو تمامًا — صفر تغيير سلوكي، اتأكد بنفس الاختبار**.
- **الـsweep الحي نفسه**: أول checkpoint اتبعت صح بعد ~دقيقة ونص (سويب كل دقيقة)، `reminder_count`
  بقى 1، `next_reminder_at` اتحرك لـcheckpoint التاني (قبل الموعد بدقيقة، مش "يوم قبله" — برضه
  اتفلتر صح لأن الموعد لسه قريب). صف `notifications` تاني اترتبط بنفس `workflow_id`.
  الفني عمل `PATCH /notifications/:id/read` على التذكير → `acknowledged_at` اتحدد فورًا.
  **إثبات قاطع إن التذكيرات بتوقف فعليًا**: `next_reminder_at` اتحطّ في الماضي يدويًا (نفس تقنية
  اختبار `action_required` الأول) → السويب الحي شافها، لاحظ `acknowledged_at` موجود، وقف فورًا
  (`next_reminder_at`→`NULL`) **من غير ما يبعت أي تذكير جديد ولا يزوّد `reminder_count`** — عدد
  صفوف `notifications` المرتبطة فضل 2 بالظبط (الإرسال الأول + التذكير الوحيد)، مش 3.
- `tsc --noEmit`/`nest build`/`jest` الثلاثة عدّوا نضيف (92 اختبار، +4 جداد لـ
  `scheduled-job-checkpoints.util`).

## `action_required` تاني — اختيار فني بديل بعد إلغاء الفني (migration `0090`، 2026-08-14)

سياسة إلغاء الفني (`docs/10`) عندها مسارين مختلفين تمامًا لما فني يلغي طلب مقبول: `AUTO_REMATCH`
(بث تلقائي لفني تاني — الطلب مش مرتبط بفني بعينه، أو الطلب طوارئ) و`MANUAL_RESELECTION_REQUIRED`
(العميل اختار الفني ده بالاسم — `orders.requested_technician_id === technician_id` — فمفيش تعيين
صامت لبديل، لازم يختار بنفسه). التمييز موجود بالفعل من زمان في `TechnicianCancellationNotification
Listener` (`recoveryAction`)، بس الاتنين كانوا بياخدوا نفس `notification_type` (`order_technician_
cancelled`) بدون أي تكرار حقيقي — بالظبط تصحيح المالك الصريح: "الرفض نفسه مش المهم، المهم هل
العميل مطلوب منه يعمل حاجة".

**الإصلاح**: نوع جديد منفصل `order_technician_cancelled_manual_reselection` (`action_required`،
migration `0090`) بس للحالة اللي العميل لازم يتصرف فيها. `order_technician_cancelled` الأصلي فضل
زي ما هو تمامًا لحالة `AUTO_REMATCH` (informational، صفر تغيير سلوكي). الـworkflow بيتحل
(`resolve('order', orderId, 'select_replacement_technician')`) لما الطلب يخرج من
`awaiting_technician_reselection` لأي وجهة — العميل اختار بديل عبر `POST /orders/:id/request-
rematch`، أو لغى الطلب بالكامل.

**اتأكد حي بالكامل عبر `curl` ضد الباك-إند الحقيقي** (عميل/فني حقيقيين، دورتي طلب كاملتين):
- **مسار `MANUAL_RESELECTION_REQUIRED`** (طلب بـ`requested_technician_id`، نفس الفني قبل، لغى
  بسبب من غير رسوم) → `order_status=awaiting_technician_reselection` صح، `notification_workflows`
  جديد فعليًا (`action_type=select_replacement_technician`, `max_reminders=24` snapshot)،
  إشعارين (`in_app` نجح، `push` فشل بأمان — مفيش جهاز مسجّل، مش استثناء يكسر الطلب) الاتنين
  مرتبطين `workflow_id`. العميل عمل `request-rematch` → `resolved_at` اتحدد فورًا،
  `next_reminder_at`→`NULL`، `reminder_count` فضل 0 (اتحل قبل أي تذكير يستحق).
- **مسار `AUTO_REMATCH`** (طلب بلا `requested_technician_id`، فني اتقبل عن طريق البث العادي، لغى
  بنفس السبب) → `order_status=searching_technician` صح، **صفر `notification_workflows` جديد**،
  والإشعار المُرسَل لسه بنفس النوع القديم `order_technician_cancelled` (مش النوع الجديد) —
  إثبات قاطع إن صفر تغيير سلوكي حصل فعليًا لهذا المسار، مش نظري.
- `tsc --noEmit`/`nest build`/`jest` الثلاثة عدّوا نضيف (92 اختبار، صفر جداد — منطق التفريع نفسه
  مغطّى بالاختبار الحي فوق، مفيش منطق حسابي جديد يستاهل unit test منفصل زي `checkpoints`).

**متبقٍ صريح من `action_required`**: دفع معلّق، رفع مستند، رد الدعم — لسه محتاجين تصميم/قرار عمل
قبل التوصيل، مش موجودين كـstate machine واضحة زي الحالتين اللي اتقفلوا. `AWAITING_PAYMENT` (order
status) اتفحص خصيصًا واتلقى **مش موصّل فعليًا لأي كود دلوقتي** — الدفع الفعلي بيحصل والطلب لسه
`work_completed` (`PAYABLE_ORDER_STATUSES` في `payments.service.ts`)، فمفيش نقطة انتقال حقيقية
لـ`AWAITING_PAYMENT` تتوصّل بيها من غير اختراع منطق عمل جديد (قرار مش موجود صراحة) — اتسجّل
كفجوة موثّقة صراحة، مش سهو.

## واجهة أدمن لـ`notification_type_configs` — `GET/PATCH /admin/notification-type-configs` (2026-08-14)

كانت فجوة موثّقة صراحة من Phase 1: تعديل الأولوية/الصوت/القناة/actionable لأي `notification_type`
كان ممكن بس عبر `psql`/migration مباشرة — بيناقض طلب المالك الصريح "كل شيء قابل للإعداد من الأدمن"
عمليًا (مفيش أدمن حقيقي يقدر يستخدم `psql`). أول endpoint حقيقي يقرا/يعدّل الجدول ده.

**`NotificationTypeConfigService`** (`list`/`update`، مفيش `create`/`delete` عمداً — صف
`notification_type_configs` بيتولّد لما نوع إشعار جديد يتضاف في الكود نفسه عبر migration seed،
مش حاجة الأدمن يخترعها بنفسه من غير أي كود بيصدرها). `GET` مفتوح لأي أدمن (بيانات غير حساسة،
نفس فلسفة `GET /admin/notification-routing-rules`)، `PATCH /:notificationType` محتاج
`notifications.manage` (الصلاحية الموجودة بالفعل، migration `0031`)، مسجّل بـ`audit_logs`
(`notification_type_config.updated`، old/new values كاملة).

**اتأكد حي بالكامل عبر `curl` ضد الباك-إند الحقيقي**: `GET` رجّع كل الأنواع المزروعة صح.
`PATCH order_assigned_scheduled` (`sound_key`, `is_actionable`, `action_labels`) اتحفظ فعليًا في
القاعدة ورجع في الرد بنفس القيم، `audit_logs` سجّل الـold/new values صح. حساب `ops_manager` (مالوش
`notifications.manage`) اترفض `AUTH_001` فورًا. القيم الأصلية اترجعت بعد الاختبار.

## عرض طلب actionable + دورة تذكير `critical_offer` (docs/08 §17.16، migration `0097`، 2026-08-14)

كانت فجوة موثّقة صراحة (بحث خلفي في نفس الجلسة، مش افتراض): **مفيش أي حدث كان بيتصدّر خالص** لما
فني يستقبل عرض طلب (عادي أو طوارئ) — على عكس مسار مطابقة المساعد (`ASSISTANT_OPPORTUNITY_OFFERED_EVENT`
كان موجود من زمان). حقول `priorityTier`/`soundKey`/`isActionable`/`actionLabels` في
`NotificationTypeConfig` كانت موجودة من ADR-0012 (schema + CRUD أدمن) بس **مش بتتقرا خالص** — مفيش
أي push كان بيوصل بأولوية عالية/صوت مخصوص/أزرار.

- **الأحداث الجديدة** (`common/events/order-offer-created.event.ts`/`order-offer-resolved.event.ts`):
  `ORDER_OFFER_CREATED_EVENT` بيتصدّر من `MatchingService.dispatchNextRound()` مرة لكل عرض،
  `ORDER_OFFER_RESOLVED_EVENT` من `accept()`/`reject()`/`MatchingRoundExpiryProcessor` بـ4 حالات
  (`accepted`/`cancelled_offer_taken`/`rejected`/`expired`). تفاصيل كاملة في `../matching/README.md`.
- **`OrderOfferNotificationListener`** (`listeners/`): عرض عادي (`order_offer`، `priority_tier=action_required`)
  → إرسال فوري بس، **بلا `NotificationWorkflow`** (نافذة الرد ثواني قليلة، تذكير "بعد ساعة" مالوش
  معنى). عرض طوارئ (`order_offer_emergency`، `priority_tier=critical_offer`) → **workflow-backed**
  فعليًا، بدورة تذكير قصيرة جوّه نافذة الصلاحية نفسها (تفاصيل تحت).
- **`OrderOfferResolutionListener`**: بيحل الـworkflow فورًا (idempotent) على أي حل، وبينبّه الفني
  الخاسر (`cancelled_offer_taken`) بإشعار `order_offer_lost` فوري — طلب المالك الصريح "الخاسر ياخد
  فورًا العرض مبقاش متاح".
- **دورة تذكير `critical_offer`** — ADR-0012 كان أجّلها صراحة ("مفيش reminder cycle لـcritical_offer
  دلوقتي"). `computeCriticalOfferCheckpoints()` (util جديد، نفس فلسفة `computeScheduledJobCheckpoints`
  بالحرف) بيحسب checkpoints كنِسَب (`notification_engine.critical_offer_reminder_ratios`، افتراضي
  `[0.5, 0.85]`) من نافذة `[sentAt, expiresAt)` نفسها — مش فاصل ثابت زي `action_required`. فرقين
  متعمّدين عن باقي التصنيفات في `NotificationWorkflowReminderService`: (1) بتتخطى ساعات الهدوء
  عمدًا (عرض طوارئ مش تذكير روتيني)، (2) `maxReminders` بيتحسب من طول قايمة الـcheckpoints نفسها
  (زي `scheduled_job`)، مش رقم ثابت.
- **`SettingsService.getJson<T>()`** (method جديدة، نفس نمط `getNumber`/`getBoolean`/`getString`)
  — أول استهلاك ليها في الموديول ده لقراءة النِسَب.
- **`FcmPushDispatcher` — push actionable حقيقي**: `NotificationsService.notify()` بقى بيقرا
  `NotificationTypeConfig` ويمرّر `priorityTier`/`soundKey`/`isActionable`/`actionLabels` للـ
  dispatcher (`DispatchNotificationInput` اتوسّعت). إشعارات `isActionable=true` بتتبعت **data-only**
  (بلا `notification` block) عمدًا — أزرار قبول/رفض حقيقية محتاجة إشعار محلي مبني على جهاز العميل
  (`flutter_local_notifications`)، حمولة FCM القياسية `notification` مالهاش أزرار قابلة للتخصيص.
  أولوية عالية (`android.priority='high'`, `apns-priority: '10'`) لـ`critical_offer`/`action_required`
  الاتنين. تفاصيل استهلاك apps/technician-app الكاملة في `../../../../technician-app/README.md`.
- **migration `0097`**: `order_offer`/`order_offer_emergency`/`order_offer_lost` type configs +
  إعداد `notification_engine.critical_offer_reminder_ratios`.
- **اختبار حي**: `critical-offer-checkpoints.util.spec.ts` (5 اختبارات وحدة — ترتيب، استبعاد نِسَب
  برّه `(0,1)`، نافذة صفر/سالبة، مصفوفة فاضية). Concurrency الفعلية (double-accept protection اللي
  دورة التذكير دي بتوقف عندها) متأكدة في `../matching/matching-accept-concurrency.spec.ts` —
  تفاصيل في `../matching/README.md`.

**فجوة موثّقة صراحة**: التحقق الفعلي على جهاز حقيقي (heads-up notification، أزرار قابلة للمس،
اهتزاز) مش ممكن في بيئة السيشن دي — الكود شغال ومتأكد بـ`tsc`/`nest build`/اختبارات حية، بس
`IMPLEMENTED — DEVICE TEST PENDING` للجزء اللي محتاج هاردوير فعلي، مطابقة لتصنيف بصمة
`apps/customer-app` في نفس الوثيقة (docs/08).

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
