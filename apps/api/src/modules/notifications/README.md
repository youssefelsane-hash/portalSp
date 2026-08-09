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

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
