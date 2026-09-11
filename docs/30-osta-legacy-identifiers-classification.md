# 30 — تصنيف بقايا "Baytak" قبل إطلاق Osta

**التاريخ**: 2026-09-10 · **السياق**: مواصفة إعداد إنتاج أندرويد والأسرار الخارجية، بند §14.

القاعدة الحاكمة للبند ده حرفيًا: **ممنوع استبدال شامل أعمى** (`find & replace` على كلمة
`baytak`). كل ظهور اتفحص وانحط في واحدة من تلات فئات:

| الفئة | المعنى | القرار |
|---|---|---|
| **A** | **مطلوب تغييره للإطلاق** — بيوصل لمستخدم/متجر/طرف خارجي | يتغيّر (أو يتوثّق كمحجوز لو ناقص معلومة من المالك) |
| **B** | **داخلي وغير ضار** — اسم كلاس/حزمة داخلية/تاريخ موثّق | يفضل زي ما هو |
| **C** | **خطر تغييره** — تغييره بيكسر بيانات قايمة أو نشر شغال | يفضل زي ما هو، مع سبب مكتوب |

---

## الفئة A — اتغيّرت فعلاً في السيشن دي

| المكان | كان | بقى | ليه |
|---|---|---|---|
| `apps/customer-app/android/app/build.gradle.kts` (`namespace` + `applicationId`) | `com.baytak.customer_app` | `com.ostahome.customer` | معرّف التطبيق على Google Play — **مايتغيّرش بعد أول رفع**، فلازم يتظبط دلوقتي |
| `apps/technician-app/android/app/build.gradle.kts` | `com.baytak.technician_app` | `com.ostahome.technician` | نفس السبب |
| مسار `MainActivity.kt` في التطبيقين + `package` جوّه | `com/baytak/...` | `com/ostahome/...` | لازم يطابق الـnamespace |
| `apps/api/src/modules/payments/payments.service.ts` (٤ مواضع) | `customer-<id>@baytak.app` | `customer-<id>@ostahome.com` | بريد بديل بيتبعت **لبوابة الدفع** في بيانات الفوترة — طرف خارجي بيشوفه، ونطاق مش بتاعنا |
| `scripts/marketing-attribution-audit.js` | رابط Play بـ`com.baytak.customer` | `com.ostahome.customer` | رابط متجر حقيقي؛ القديم بيروح لصفحة مش موجودة |
| `apps/api/.env.example`، `configuration.ts`، `websocket-cors.util.spec.ts`، `http-bootstrap.spec.ts` | أمثلة `baytak.com` / `admin.baytak.app` | `ostahome.com` / `admin.ostahome.com` | §13 — أمثلة الإطلاق لازم تكون على النطاق الحقيقي |

## الفئة A — iOS وmacOS (اتغيّرت بعد اعتماد Firebase)

| المكان | القيمة القديمة | القيمة المعتمدة |
|---|---|---|
| تطبيق العميل على iOS وmacOS | `com.baytak.customerApp` (+ `.RunnerTests`) | `com.ostahome.customer` (+ `.RunnerTests`) |
| تطبيق الفني على iOS وmacOS | `com.baytak.technicianApp` (+ `.RunnerTests`) | `com.ostahome.technician` (+ `.RunnerTests`) |

**دليل الاعتماد**: مشروع Firebase الإنتاجي `osta-production` يحتوي تطبيقات iOS بالمعرّفين نفسهما.
ملفا `GoogleService-Info.plist` المحليان يُضافان إلى Target كل تطبيق ولا يدخلان Git لأنهما إعدادات
بيئة إنتاج. يبقى على Apple Developer/App Store Connect فقط تسجيل المعرفين وربطهما بفريق التوقيع.

---

## الفئة B — داخلي وغير ضار (اتساب عمدًا)

| المكان | الظهور | ليه ساكت |
|---|---|---|
| `packages/shared-types` وكل مستهلكيها | اسم الحزمة `@baytak/shared-types` | حزمة **داخلية للمونوريبو**، مش منشورة على أي registry ومحدش براّنا بيشوفها. تغييرها = لمس ~١٠٠ سطر `import` + `package.json` + مسارات `tsconfig` مقابل صفر مكسب |
| `apps/customer-app/lib/core/auth_repository.dart`, `main.dart` (ونظيرهم في تطبيق الفني) | `BaytakUser`, `BaytakApp`, `BaytakTechnicianApp` | أسماء أصناف Dart داخلية — المستخدم مابيشوفش أي واحد منهم (الاسم المعروض بييجي من `applicationLabel`/`CFBundleDisplayName`) |
| `apps/*/linux/CMakeLists.txt`, `apps/*/windows/runner/Runner.rc` | `com.baytak.*` | سقالة Flutter لسطح المكتب — **مش أهداف إطلاق أصلاً**، ومابتتبنيش ولا بتترفع لأي متجر |
| `docs/**`, `README.md`, `CLAUDE.md`, `docs/system-audit/**` | ذكر تاريخي للاسم القديم | التوثيق سجل تاريخي؛ إعادة كتابته بتمسح ليه القرارات اتاخدت. الوثائق **الموجّهة للإطلاق** (`docs/03`) اتحدّثت بالفعل حيث لزم |
| `apps/api/src/http-bootstrap.spec.ts` | `/srv/baytak/uploads` | مسار **وهمي** جوه اختبار، مالوش أي وجود على أي قرص |
| `package-lock.json` | اسم حزمة الجذر | داخلي، والتغيير بيعيد توليد الملف كله بلا داعي |
| `.devcontainer/*`, `scripts/mac-dev-up.sh`, `scripts/sweep-*.js`, `.github/workflows/ci.yml` | أسماء قواعد/مستخدمين للتطوير المحلي والـCI | بيئات تطوير مؤقتة بتتبني وتتمسح؛ الأسماء متسقة مع `docker-compose` تحت |

---

## الفئة C — **خطر تغييره** (اتساب عمدًا، بسبب مكتوب)

| المكان | الظهور | إيه اللي بيتكسر لو اتغيّر |
|---|---|---|
| `apps/*/lib/core/auth_repository.dart` | مفاتيح التخزين الآمن `baytak_access_token` / `baytak_refresh_token` | كل مستخدم **مثبِّت التطبيق حاليًا** هيتسجّل خروجه فجأة عند التحديث — المفتاح الجديد مالوش قيمة مخزّنة. مفيش أي مكسب مقابل ده. لو اتغيّر يومًا، لازم يتعمل بهجرة تقرا المفتاح القديم وتكتب الجديد وتمسح القديم |
| `apps/api/src/modules/payments/payments.service.ts` | مفتاح الحمولة `__baytak_delivery_hmac` | القيمة دي **مخزّنة فعلاً** في صفوف `webhook_events.payload` القديمة. تغيير الاسم بيخلّي التحقق من أي حدث محفوظ قبل كده يفشل — وده مسار مالي |
| `infra/docker/docker-compose.yml` | اسم المشروع، `container_name`، `POSTGRES_USER/DB`، أسماء الـvolumes | تغيير اسم الـvolume = **قاعدة بيانات فاضية** لأي حد شغّال محليًا؛ تغيير `POSTGRES_USER/DB` = كل `DATABASE_URL` في كل جهاز بيبوظ |
| `infra/systemd/baytak-api.service`, `baytak-backup.service` | اسم الوحدة، `/opt/baytak`، `User=baytak` | الوحدات دي **متسطّبة فعلاً** على السيرفر (`systemctl enable --now baytak-api`). تغيير الاسم في الريبو بلا تغيير مطابق على السيرفر = وحدة يتيمة وخدمة مش بتقلع |
| `scripts/backup-db.sh`, `docs/runbooks/disaster-recovery.md` | أسماء ملفات ومسارات النسخ الاحتياطي | **النسخ الاحتياطية الموجودة دلوقتي** متسمّية بالنمط ده؛ تغيير السكريبت بيخلّي إجراء الاسترجاع الموثّق مايلاقيش الملفات وقت الأزمة — أسوأ لحظة ممكنة للاكتشاف |
| `infra/migrations/0123_realtime_access_revocation.sql` | ذكر داخل migration اتعمله commit | **قاعدة المشروع**: migration اتعمله commit مايتعدّلش أبدًا (`docs/01` §1.3) — التعديل بيغيّر الـchecksum وبيفشّل التطبيق على أي قاعدة شغالة |

---

## خلاصة

- **A منفّذة**: ٧ مواضع (معرّفات أندرويد، بريد بوابة الدفع، رابط المتجر، أمثلة النطاق).
- **A منفّذة**: معرّفات حزم iOS وmacOS اعتمدت على تطبيقات Firebase الإنتاجية الموجودة.
- **B**: اتسابت — أسماء داخلية وتوثيق تاريخي وسقالة منصات مش أهداف إطلاق.
- **C**: اتسابت بسبب صريح — مفاتيح تخزين لمستخدمين حاليين، حمولة مخزّنة، بنية نشر شغالة،
  وmigration اتعمله commit.

أي سيشن جاية عايزة تلمس بقايا `baytak`: **اقرا الجدول ده الأول**. لو الظهور في فئة C، التغيير
محتاج خطة هجرة مكتوبة، مش تعديل نص.
