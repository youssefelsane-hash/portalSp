# common/storage

واجهة تخزين ملفات مجرّدة (`StorageService`) — أي موديول محتاج يرفع ملف (صور طلبات، مستندات فنيين، مرفقات شكاوى) بيتعامل مع الواجهة دي بس، مش مع التطبيق الفعلي.

## التطبيقين المتاحين

- **`LocalDiskStorageService`**: بيكتب على القرص محلياً، مناسب للتطوير بس (`STORAGE_PROVIDER=local`, الافتراضي).
- **`S3StorageService`** — كانت فجوة موثّقة ("محتاجة إنترنت خارجي")، اتقفلت معمارياً: تكامل حقيقي مبني على `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`، بيشتغل مع AWS S3 نفسه أو أي بديل S3-compatible (DigitalOcean Spaces، Cloudflare R2، MinIO) عبر `S3_ENDPOINT` اختياري. تفعيله = `STORAGE_PROVIDER=s3` + بيانات الاعتماد في `.env` (تفاصيل كل قيمة ومكانها بالظبط: `docs/03-external-integrations.md`) — من غير أي تعديل كود.

التبديل بين الاتنين مركزي في `storage.provider.ts` (`storageServiceProvider`) — مستخدم في `orders.module.ts`، `support.module.ts`، و`technicians.module.ts` الثلاثة، فتغيير `STORAGE_PROVIDER` واحد بيطبّق على كل استهلاكات التخزين في النظام مرة واحدة.

## قرار تصميم صريح: presigned URL بمدة 7 أيام، مش 15 دقيقة

القاموس (`docs/01-master-plan.md` §7.2) بيقول "روابط موقّتة، صلاحية 15 دقيقة". `S3StorageService` الحالي بيرجّع presigned URL فعلاً — بس بمدة 7 أيام (أقصى مدة مسموحة لـ AWS SigV4 presigned URLs)، مش 15 دقيقة. السبب: `StorageService.save()` بترجع سترينج واحد بيتخزن *دايماً* في عمود `file_url` (`order_media`/`complaint_attachments`/`technician_documents`) وبيتقرا كما هو في كل رد API بعد كده — تطبيق "15 دقيقة" حرفياً كان محتاج تخزين الـ key بس (مش رابط) وتعديل 4 مسارات قراءة مختلفة (`order-media`, `complaint-attachment`, `technician-document`, `chat-message`) عشان يولّدوا رابط presigned جديد وقت كل قراءة — تغيير معماري أوسع بكتير من نطاق "أضف S3 adapter"، وغير قابل للاختبار حياً هنا أصلاً (مفيش S3 حقيقي متاح للتأكد). 7 أيام بتغطي عملياً كل حالات الاستخدام الحالية (مراجعة صور/مستندات بعد الرفع بوقت قريب نسبياً). **تحسين مستقبلي موثّق صراحة**: الانتقال لتخزين الـ key + توليد الرابط وقت القراءة، لو الأمان بمستوى "15 دقيقة بالظبط" أصبح مطلوب فعلياً.

مرجع كامل: `../../../../docs/01-master-plan.md`، `../../../../docs/03-external-integrations.md`
