# common/storage

واجهة تخزين ملفات مجرّدة (`StorageService`) — أي موديول محتاج يرفع ملف (صور طلبات، مستندات فنيين، مرفقات شكاوى) بيتعامل مع الواجهة دي بس، مش مع التطبيق الفعلي.

## التطبيقين المتاحين

- **`LocalDiskStorageService`**: بيكتب على القرص محلياً، مناسب للتطوير بس (`STORAGE_PROVIDER=local`, الافتراضي).
- **`S3StorageService`** — كانت فجوة موثّقة ("محتاجة إنترنت خارجي")، اتقفلت معمارياً: تكامل حقيقي مبني على `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`، بيشتغل مع AWS S3 نفسه أو أي بديل S3-compatible (DigitalOcean Spaces، Cloudflare R2، MinIO) عبر `S3_ENDPOINT` اختياري. تفعيله = `STORAGE_PROVIDER=s3` + بيانات الاعتماد في `.env` (تفاصيل كل قيمة ومكانها بالظبط: `docs/03-external-integrations.md`) — من غير أي تعديل كود.

التبديل بين الاتنين مركزي في `storage.provider.ts` (`storageServiceProvider`) — مستخدم في `orders.module.ts`، `support.module.ts`، و`technicians.module.ts` الثلاثة، فتغيير `STORAGE_PROVIDER` واحد بيطبّق على كل استهلاكات التخزين في النظام مرة واحدة.

## قرار تصميم صريح: presigned URL بمدة 7 أيام، مش 15 دقيقة

القاموس (`docs/01-master-plan.md` §7.2) بيقول "روابط موقّتة، صلاحية 15 دقيقة". `S3StorageService` الحالي بيرجّع presigned URL فعلاً — بس بمدة 7 أيام (أقصى مدة مسموحة لـ AWS SigV4 presigned URLs)، مش 15 دقيقة. `StorageService.save()` لسه بترجع سترينج واحد بيتخزن في `file_url` وقت الرفع (لأي استهلاك مستقبلي أو تصحيح يدوي) — بس القراءة بقت تعتمد على نمط تاني، تفاصيل تحت.

## نمط `getUrl(key)` — تعميم على order_media/technician_documents/complaint_attachments (docs/08 §19 بند 9، اتقفلت)

كانت فجوة موثّقة صراحة هنا نفسها: `file_url` المخزّن بيبقى ميت (404) بعد 7 أيام مع S3، ومفيش آلية تجديد وقت القراءة — بس `branding` module كان مصلّح (بيخزّن الـ`key` بس، `getUrl(key)` بيولّد رابط طازة وقت كل قراءة). النمط ده بقى معمّم دلوقتي على التلات جداول التانية اللي عندهم نفس المشكلة:

- **الكتابة**: `order-media.service.ts`/`technician-documents.service.ts`/`support.service.ts`'s `uploadAttachment()` بقوا بيسجّلوا `storageKey: key` (عمود جديد، `infra/migrations/0102`) جنب `fileUrl` القديم (بيفضل يتسجّل برضو، مش بيتشال — مفيد كـfallback/تصحيح يدوي).
- **القراءة**: `toOrderMediaResponseDto()`/`toTechnicianDocumentResponseDto()`/`toComplaintAttachmentResponseDto()` بقوا `async` وبياخدوا `StorageService` — لو `storageKey` موجود (رفع بعد الإصلاح)، رابط طازة عبر `storage.getUrl(key)` بيتولّد كل مرة؛ لو `null` (صف قديم قبل الإصلاح، مفيش key أصلي متسجّل ليه)، `fileUrl` المخزّن بيتستخدم زي ما هو (مفيش backfill ممكن). كل الكنترولرات اللي بتنادي المابرز دي (`OrdersController`/`AdminOrdersController`/`TechnicianOrderExecutionController`/`TechniciansController`/`AdminTechniciansController`/`SupportController`) بقت تحقن `StorageService` وتستخدم `Promise.all()` للمصفوفات.

**اتأكد** (`getUrl-response-mappers.spec.ts`، اختبار وحدة نقي بدون DB): التلات مابرز بيتصرفوا صح — `storageKey` موجود يستدعي `storage.getUrl(key)` ويرجّع نتيجته، `storageKey=null` يرجّع `fileUrl` القديم بلا أي نداء لـ`storage` خالص.

**فجوة مطابقة، خارج نطاق بند 9 (اللي حدد صراحة التلات جداول دول بس)، موثّقة صراحة**: `technician_certificates` (`technician-certificates.service.ts`/`certificate-response.dto.ts`) عندها **نفس البَقّة بالظبط** (`file_url` ثابت بيتخزن دائم، مفيش `storage_key`) — اتلقطت أثناء المراجعة دي بس متصلحتش عمدًا (خارج التلات جداول المحددة صراحة في تدقيق المالك)، محتاجة نفس الإصلاح ميكانيكيًا كامتداد لاحق.

## `file-signature-validator.ts` — magic bytes بدل الثقة في `mimetype` المُعلَن (docs/08 §19 بند 10، اتقفلت)

كانت فجوة أمنية موثّقة صراحة في تدقيق المالك: كل مسارات رفع الملفات في النظام (order media، chat
images، technician documents/certificates، complaint attachments) كانت بتتحقق من نوع الملف
بمقارنة `file.mimetype` بس — القيمة دي جايه من `Content-Type` header اللي الكلاينت بيبعته في
الـmultipart request، سهلة التزوير تمامًا (مهاجم يقدر يرفع أي محتوى ويسمّيه `image/png`). نفس
المبدأ اللي `branding-file-validator.ts` كان مطبّقه من زمان (ADR-0014) — فحص أول بايتات الملف
الحقيقية (magic bytes) والتأكد إنها بتطابق المُعلَن — اتعمم هنا في `assertFileSignatureMatches()`
جديدة (`detectActualFileFormat()` بتدعم PNG/JPEG/WEBP + PDF لمستندات/شهادات الفني)، وحلّت محل
فحص `ALLOWED_X.has(file.mimetype)` القديم في الخمس كنترولرات: `technician-order-execution.controller.ts`
(order media)، `chat.controller.ts` (صور الشات)، `technicians.controller.ts` (documents +
certificates، موقعين)، `support.controller.ts` (مرفقات الشكاوى). كل موقع بقى بينادي
`assertFileSignatureMatches(file.buffer, file.mimetype, ALLOWED_X)` بدل التحقق اليدوي القديم —
تبديل سطر واحد ميكانيكي في كل موقع، الـ`allowedMimeTypes` set نفسه فضل زي ما هو لكل كنترولر
(مفيش تغيير في الأنواع المسموحة، بس التحقق بقى حقيقي مش شكلي).

`branding-file-validator.ts` فضل زي ما هو عمدًا (منطق إضافي خاص بيه: فحص أبعاد الصورة، حدود
حجم مختلفة) — مش موحّد مع الملف الجديد ده تجنبًا لأي regression على اختباراته الموجودة، رغم
تطابق منطق كشف الـmagic bytes بين الاتنين تقريبًا 1:1.

**اتأكد** (`file-signature-validator.spec.ts`، 6 اختبارات وحدة نقية بدون DB): كشف صحيح لكل
الأنواع الأربعة من بايتاتها الحقيقية، رفض محتوى مش معروف، رفض MIME مش في القايمة المسموحة أصلاً،
وسيناريو الهجوم الفعلي (بند 10 بالحرف): ملف مش صورة خالص متسمّي `image/png`، وملف PDF حقيقي
متسمّي `image/jpeg` عشان يعدّي فلتر "صور بس" — الاتنين بيترفضوا بوضوح. `tsc --noEmit` →
`nest build` → `jest` (30 suite، 160 اختبار) كلهم عدّوا نضيف.

## `LocalDiskStorageService` كان بيرجّع رابط نسبي بس — بَقّة حقيقية اتلقطت واتصلحت (2026-08-23)

كانت بَقّة حقيقية، مش موثّقة قبل كده: `LocalDiskStorageService.save()`/`.getUrl()` كانوا بيرجّعوا
`/uploads/${key}` — مسار نسبي من غير scheme/host، عكس `S3StorageService.getUrl()` اللي بترجّع
presigned URL **مطلق** دايمًا (`https://<bucket-host>/...`). المسار النسبي ده شغال بس لو
الـconsumer بيحمّل الصورة من نفس أصل الـAPI بالظبط — مش الحال أبدًا: `apps/admin` على origin/port
مختلف (3001 مقابل 3000)، وكذلك `apps/customer-web`/تطبيقات Flutter (كلهم بينادوا الـAPI عبر CORS
عمدًا، راجع `apps/admin/src/lib/api-client.ts`). المتصفح كان بيحل `<img src="/uploads/...">` ضد
أصل الصفحة الحالية (مثلاً `localhost:3001`) بدل أصل الـAPI (`localhost:3000`) — صورة معطوبة تمامًا
(404 أو توجيه غلط لصفحة تانية حسب routing الـfrontend نفسه).

**اتلقطت** لما المالك رفع لوجو JPG حقيقي من `/branding` (لوحة الأدمن، تخزين محلي في بيئة التطوير) —
البادچ اتحدّث لـ"مرفوع" والتوست "اترفع بنجاح" ظهر (يعني الرفع + الـDB + إبطال الكاش كلهم شغالين
صح)، بس مكان الصورة فضل فاضي (broken image icon) لأن الرابط الراجع كان بيتحل غلط في متصفح الأدمن.
**اتأكد حي**: Playwright + CDP virtual WebAuthn authenticator (تسجيل دخول admin تجريبي حقيقي →
ceremony=registration → رفع JPG حقيقي → `403 AUTH_006` → `StepUpDialog` → تأكيد → `201`) — الصورة
فضلت معطوبة قبل الإصلاح (تأكدت من `GET /branding`: الرابط راجع `/uploads/...` بلا host)، وظهرت صح
بعد الإصلاح (الرابط بقى `http://localhost:3000/uploads/...`، و`curl` على الرابط رجّع `200`).

**الإصلاح**: `LocalDiskStorageService` بقى بياخد `storage.localPublicBaseUrl` جديد (`ConfigService`،
افتراضي `http://localhost:<PORT>` — شغال بدون أي تعديل env لبيئة التطوير المحلية، قابل للتظبيط عبر
`STORAGE_LOCAL_PUBLIC_BASE_URL` لو احتجت دومين تاني) ويبني الرابط الكامل بيه (`buildUrl()`) بدل
مسار نسبي — نفس فلسفة S3 presigned URLs بالظبط (رابط قابل للاستخدام من أي أصل، مش بس أصل الـAPI).
مفيش تأثير على الإنتاج — الإنتاج مرفوض يقلع بـ`STORAGE_PROVIDER=local` أصلاً (docs/08 §19 بند 16،
`S3_PROVIDER=s3` إجباري)، فالبَقّة دي كانت محصورة في بيئة التطوير المحلية بس، لكنها بتأثر فعليًا على
أي مطوّر بيختبر البراندنج/صور الطلبات/مستندات الفنيين محليًا بلا S3.

مرجع كامل: `../../../../docs/01-master-plan.md`، `../../../../docs/03-external-integrations.md`
