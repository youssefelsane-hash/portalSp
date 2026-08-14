# Branding — نظام البراندنج القابل للإدارة من الأدمن

راجع `docs/adr/0014-admin-managed-branding.md` للقرار الكامل والسياق.

## الملخص

Super Admin بيرفع/يستبدل أصول البراندنج (لوجو أساسي، رمز مختصر، نسخ فاتحة/غامقة، لوجو شاشة
الدخول، splash) من لوحة الإدارة — بلا أي تعديل كود ولا deployment. مفيش hardcoding لملف لوجو
معين في الكود؛ الأصول الحقيقية اللي المالك بيرفعها بتحل محل fallback مبني في الكود (SVG بسيط جدًا،
مش تصميم نهائي) فورًا بمجرد الرفع.

## الـEndpoints

- `GET /branding` (`@Public()`) — الاستهلاك العام (Customer/Technician apps + Admin panel). أبدًا
  ميرميش خطأ — أي فشل (DB/Redis/تخزين واقع) بيترجع fallback كامل، مسجّل تحذير بس.
- `GET /admin/branding` (`branding.manage`) — نفس البيانات + تفاصيل إدارية (مين رفع، امتى).
- `POST /admin/branding/:assetType` (`branding.manage` + Step-Up ADR-0011) — رفع/استبدال، multipart.
- `DELETE /admin/branding/:assetType` (`branding.manage` + Step-Up) — رجوع للـfallback.

`assetType` واحد من: `primary_logo`, `logo_mark`, `logo_light`, `logo_dark`, `login_logo`, `splash`.

## التحقق من الملف (أمان)

- PNG/JPEG/WEBP بس — **مفيش SVG خالص** (وعاء تنفيذ سكربت حقيقي).
- `mimetype` المُعلَن لازم يطابق magic bytes الحقيقية للملف — تزوير الـ`Content-Type` مرفوض.
- أبعاد بين 32 و4096 بكسل، حجم أقصى 5MB.
- راجع `branding-file-validator.ts` + `branding-file-validator.spec.ts` (12 اختبار، بيغطي تزوير
  الـmimetype وSVG-masquerading-as-PNG صراحة).

## التخزين

بيعيد استخدام `StorageService` الموجودة (`common/storage/`) بالكامل — مفيش بنية تخزين جديدة. إضافة
واحدة بس على الواجهة: `getUrl(key): Promise<string>` — لازمة لأن S3 presigned URLs بتنتهي بعد
`urlExpirySeconds`، فمينفعش نخزّن رابط دائم لأصل المفروض يفضل شغال للأبد. `branding_assets` بتخزّن
الـ`storage_key` بس، والرابط بيتولّد طازة وقت كل قراءة (كاش 5 دقايق فوقه، `BrandingService`).

كل رفع جديد بيتخزّن تحت مفتاح جديد كليًا (UUID) — الملف القديم مبيتمسحش فورًا، فاستبدال الصورة
مبيكسرش عملاء متكاشين على الرابط القديم.

## فجوات موثّقة صراحة

- **توليد نسخ محسّنة تلقائيًا (resize) مؤجّل** — بيحتاج `sharp` (native binary)، تعقيد تشغيلي إضافي
  مقابل فايدة محدودة (الأدمن مفروض يرفع صور جاهزة للويب أصلاً، الحدود الحالية كافية تمنع الإساءة).
- **مفيش تاريخ نسخ (versioning)** — صف واحد أقصى لكل `asset_type`، قرار Phase 1 مبسّط عمدًا.
- **تكامل Flutter/Next.js مع `GET /branding` بره نطاق هذا الموديول** — Backend API بس هنا.
