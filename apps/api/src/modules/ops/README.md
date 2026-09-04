# ops — مراقبة تشغيلية (queue watchdog)

الجزء الأول من خطة "supervisor/health-check/restart" اللي وعدنا بيها في `technicians/README.md`
لإغلاق فجوة "الـWorker مبيرجّعش يعالج وظايف جديدة بعد انقطاع Redis طويل" (مطابقة لـBullMQ issue
[#4479](https://github.com/taskforcesh/bullmq/issues/4479) — التحقيق الكامل هناك).

## `QueueWatchdogService`

بيفحص **كل الطوابير الأربعة** على فترة دورية. لو أقدم وظيفة في `wait` list قاعدة أكتر من عتبة
معيّنة **و**`getWaiting()` نجحت (يعني Redis متاح فعلاً)، ده توقيع البَقّة الموثّقة بالظبط.

**عمدًا مفيش أي محاولة "إصلاح" من جوّه نفس الـprocess** — 3 محاولات سابقة (موثّقة في
`technicians/README.md`) أثبتت إن ده مستحيل من كود التطبيق. القرار: اكتشاف سريع + إغلاق رشيق،
والاستعادة الفعلية لطبقة تانية تمامًا (`infra/systemd/baytak-api.service`, `Restart=always`).

### تدرّج الخطورة — مش كل طابور يستاهل إسقاط الخدمة (تدقيق C-1)

النسخة الأولى كانت بتعامل الطوابير بنفس الخطورة: أي واحد يعلّق ⇒ `process.exit(1)` فورًا. يعني
**طابور تجميلي بالكامل كان بيسقّط الـAPI كله** — `customer-stats` (إعادة حساب `totalOrdersCount`
للعرض) يعلّق، فعميل في نص `payWithWallet` وفني في نص `collectCash` ياخدوا connection reset، وطلب
طوارئ في نص التوزيع يتعلّق لحد ما الـprocess يرجع. علاج أخطر من المرض.

المعيار الفاصل دلوقتي سؤال واحد: **هل تعليق الطابور ده بيسيب طلب حقيقي بلا حد يشتغل عليه؟**

| الطابور | التصنيف | تعليقه بيعمل إيه |
|---|---|---|
| `matching-rounds` | `DISPATCH_CRITICAL` | عميل مستني ومحدش رايح له ⇒ **إعادة تشغيل** |
| `assistant-matching` | `DISPATCH_CRITICAL` | طلب فريق معلّق بلا طاقم ⇒ **إعادة تشغيل** |
| `customer-stats` | `DEFERRED` | رقم معروض بيتأخر ⇒ `error` في اللوج، الخدمة تفضل شغّالة |
| `technician-stats` | `DEFERRED` | نفس الحالة ⇒ `error` في اللوج بس |

`assistant-matching` كان **خارج المراقبة أصلاً** (تدقيق C-2): أربع طوابير مسجّلة والـwatchdog حاقن
تلاتة. الطابور الرابع هو الأحدث (أقل اختبارًا) وتعليقه بيسيب طلب فريق معلّق للأبد. القايمة دلوقتي
`watchedQueues` واحدة ومصنّفة والنوع بيفرض تصنيف مع أي طابور جديد.

### إغلاق رشيق بدل قتل فوري (تدقيق S-2)

`process.exit(1)` الخام كان بيقتل الـprocess في نص أي طلب جاري (Postgres بيعمل rollback فمفيش فساد
بيانات، بس المستخدم بيشوف فشل شبكة خام). دلوقتي `process.kill(process.pid, 'SIGTERM')` —
و`app.enableShutdownHooks()` في `main.ts` بيحوّلها لإغلاق NestJS كامل (وقف قبول طلبات جديدة ←
إنهاء الجاري ← `onModuleDestroy` بتقفل DB/Redis). لو الإغلاق نفسه علّق، مؤقّت الخروج القسري
بيقطعها بعد `ops.queue_watchdog_shutdown_grace_seconds`. `Restart=always` بيعيد التشغيل أيًا كان
كود الخروج.

## الإعدادات (`group_name='ops'`, migrations `0073` و`0263`)

| المفتاح | الافتراضي | الوصف |
|---|---|---|
| `ops.queue_watchdog_enabled` | `true` | تعطيل الميكانيزم كله لو لزم الأمر |
| `ops.queue_watchdog_check_interval_minutes` | `2` | كل قد إيه يتعمل فحص |
| `ops.queue_watchdog_stall_threshold_minutes` | `5` | أقل مدة وقوف قبل ما تتعتبر بَقّة |
| `ops.queue_watchdog_shutdown_grace_seconds` | `10` | مهلة الإغلاق الرشيق قبل الخروج القسري |

**`shutdown_grace_seconds` لازم يفضل أقل من `TimeoutStopSec=30`** في وحدة systemd — شبكة الأمان
بتاعتنا لازم تسبق سكين systemd، وإلا مابتتنفّذش أصلاً.

## `infra/systemd/baytak-api.service`

وحدة systemd بـ`Restart=always`/`RestartSec=5` — هي اللي بتكمل الحلقة فعليًا بعد ما الـwatchdog
يطلب الإغلاق. تفاصيل التركيب في تعليقات الملف نفسه.

## اتأكد إزاي

**التحقق الأصلي (النسخة الأولى)**: طابور `technician-stats` اتعمله `pause()` مباشر عبر Redis
(بيحاكي أثر Worker عالق تمامًا)، وظيفة اتضافت، إعدادات الفحص اتأقّتت لثواني، السيرفر اتعاد تشغيله.
الـwatchdog اكتشف الوظيفة الواقفة بعد أول دورة فحص، سجّل `CRITICAL`، وعمل `process.exit(1)` فعليًا.

**التحقق بعد التدرّج**: `queue-watchdog.service.spec.ts` بيقفل السلوك الجديد بستة سيناريوهات —
طابور تجميلي معلّق مايطلبش إعادة تشغيل خالص، طابور توزيع معلّق بيطلبها بـ`SIGTERM` (مش `exit`)،
`assistant-matching` مراقَب فعلاً، الوقوف تحت العتبة مالوش أثر، الطلب بيحصل مرة واحدة بس مهما
اتكرر الفحص، وRedis الواقع مايتحسبش بَقّة. لاحظ إن نفس السيناريو اللي كان بيسقّط الخدمة في النسخة
الأولى (`technician-stats` معلّق) بقى دلوقتي `error` في اللوج بس — وده المقصود بالظبط.
