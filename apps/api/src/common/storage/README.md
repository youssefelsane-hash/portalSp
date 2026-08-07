# common/storage

واجهة تخزين ملفات مجرّدة (`StorageService`) — أي موديول محتاج يرفع ملف (صور طلبات، مستندات فنيين، إلخ) بيتعامل مع الواجهة دي بس، مش مع التطبيق الفعلي.

`LocalDiskStorageService` هو التطبيق الوحيد دلوقتي — بيكتب على القرص محلياً، مناسب للتطوير بس. الإنتاج لازم يستخدم S3-compatible (AWS S3 / DigitalOcean Spaces / MinIO) مع روابط موقّتة (presigned, صلاحية 15 دقيقة) — راجع `docs/01-master-plan.md` §2.2 و §7.2. التبديل بيبقى تغيير الـ provider في `orders.module.ts` (`{ provide: STORAGE_SERVICE, useClass: ... }`) من غير ما يتلمس أي كود بيستخدم الواجهة.

مرجع كامل: `../../../../docs/01-master-plan.md`
