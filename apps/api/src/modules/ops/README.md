# ops — مراقبة تشغيلية (queue watchdog)

الجزء الأول من خطة "supervisor/health-check/restart" اللي وعدنا بيها في `technicians/README.md`
لإغلاق فجوة "الـWorker مبيرجّعش يعالج وظايف جديدة بعد انقطاع Redis طويل" (مطابقة لـBullMQ issue
[#4479](https://github.com/taskforcesh/bullmq/issues/4479) — التحقيق الكامل هناك).

## `QueueWatchdogService`

بيفحص كل الطوابير الثلاثة (`matching-rounds`, `customer-stats`, `technician-stats`) على فترة
دورية. لو أقدم وظيفة في `wait` list قاعدة أكتر من عتبة معيّنة **و**`getWaiting()` نجحت (يعني Redis
متاح فعلاً)، ده توقيع البَقّة الموثّقة بالظبط — بيتسجّل `CRITICAL` ويتعمل `process.exit(1)` نظيف.

**عمدًا مفيش أي محاولة "إصلاح" من جوّه نفس الـprocess** — 3 محاولات سابقة (موثّقة في
`technicians/README.md`) أثبتت إن ده مستحيل من كود التطبيق. القرار: اكتشاف سريع + موت نظيف،
والاستعادة الفعلية لطبقة تانية تمامًا (`infra/systemd/baytak-api.service`, `Restart=always`).

## الإعدادات (`group_name='ops'`, migration `0073`)

| المفتاح | الافتراضي | الوصف |
|---|---|---|
| `ops.queue_watchdog_enabled` | `true` | تعطيل الميكانيزم كله لو لزم الأمر |
| `ops.queue_watchdog_check_interval_minutes` | `2` | كل قد إيه يتعمل فحص |
| `ops.queue_watchdog_stall_threshold_minutes` | `5` | أقل مدة وقوف قبل ما تتعتبر بَقّة |

## `infra/systemd/baytak-api.service`

وحدة systemd بـ`Restart=always`/`RestartSec=5` — هي اللي بتكمل الحلقة فعليًا بعد ما الـwatchdog
يعمل exit. تفاصيل التركيب في تعليقات الملف نفسه. `main.ts` بينادي `app.enableShutdownHooks()`
عشان الإغلاق يبقى نظيف وقت `SIGTERM` (مش انتظار `TimeoutStopSec` كامل ثم `SIGKILL`).

## اتأكد إزاي

طابور `technician-stats` اتعمله `pause()` مباشر عبر Redis (بيحاكي أثر Worker عالق تمامًا — الطابور
بيستقبل وظايف بس محدش بيعالجها)، وظيفة اتضافت، إعدادات الفحص اتأقّتت لثواني، السيرفر اتعاد تشغيله.
النتيجة: الـwatchdog اكتشف الوظيفة الواقفة بعد أول دورة فحص بالظبط، سجّل `CRITICAL` كامل، وعمل
`process.exit(1)` فعليًا (اتأكد بـ`ps aux`). الطابور اترجع `resume()` والإعدادات ارجعت لقيمها
الافتراضية بعد التأكيد. `tsc`/`nest build`/`jest` عدّوا نضيف.
