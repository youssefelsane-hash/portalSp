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

مرجع كامل: `../../../../docs/01-master-plan.md`، `../../../../docs/03-external-integrations.md`
