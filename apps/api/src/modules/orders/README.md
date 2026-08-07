# modules/orders

الطلبات ودورة حياتها الكاملة (state machine مقفولة). جداول: orders, order_status_history, order_items, order_media, order_assignments, cancellation_reasons (قاموس §6). الجدول الأخطر في النظام كله.

**الحالة: شغال (S3 + S5).**

- `order-state-machine.ts`: مصدر الحقيقة الوحيد لانتقالات الحالة الكاملة (كل الـ 18 حالة من القاموس §6.2)، مقفولة تماماً — أي انتقال مش معرّف فيها يرمي `ORDR_003`. مبنية كاملة من الأول عشان موديولات `matching`/`payments`/`support` تستخدم نفس الملف من غير ما تتلمس تاني.
- `POST /orders`: بيتحقق من ملكية العنوان، الخدمة نشطة، فيه نطاق خدمة للمدينة (`ORDR_001` لو لأ)، بيحسب السعر التقديري عبر `catalog`، وبيولّد `order_number` من `next_human_readable_number('ORD')` — كل ده جوّه transaction واحدة مع أول صف في `order_status_history`.
- `POST /orders/:id/cancel`: بيتحقق إن الحالة الحالية لسه قابلة للإلغاء من العميل (قبل ما الفني يوصل)، وبيرفض أي محاولة إلغاء تانية على طلب اتلغى قبل كده.
- `GET /orders`, `GET /orders/:id`: للعميل صاحب الطلب بس.
- **`TechnicianOrderExecutionController`** (S5) — دورة عمل الفني بعد القبول: `POST /technician/orders/:id/depart|arrive|start|complete`، كل واحدة بتتحقق إن الطلب فعلاً بتاع الفني ده (`order.technicianId`) وإن الانتقال مسموح في الـ state machine قبل ما تسجّله، وبتحدّث عمود التوقيت المناسب (`technician_departed_at`... إلخ).
- **رفع الصور (`order_media`)**: `POST /technician/orders/:id/media` (multipart, حقل `file` + `media_type`) و `GET /technician/orders/:id/media`. التخزين وراه واجهة `StorageService` (`common/storage/`) — التطبيق الحالي `LocalDiskStorageService` (قرص محلي، للتطوير بس)، والإنتاج المفروض يبدّلها لـ S3-compatible presigned URLs (§2.2 و §7.2 في الماستر بلان) بتغيير provider واحد في `orders.module.ts` من غير ما يتلمس أي كود تاني.
- اتعمله اختبار end-to-end فعلي كامل: إنشاء طلب → قبول فني → `depart`→`arrive`→`start` بالترتيب الصح، ومحاولة `complete` قبل الأوان اترفضت صح (`ORDR_003`) → رفع صورة PNG حقيقية اتكتبت فعلاً على القرص (اتأكد منها بـ `file` command) وسجل `order_media` صحيح → `complete` نجح → تاريخ الحالات الكامل (7 صفوف) مطابق تماماً لتسلسل القاموس.
- لسه من غير: `order_items` (إضافة قطع غيار/أجرة إضافية بموافقة العميل — جزء من S7)، `cancellation_reasons` مُفعّلة، تعديل السعر بعد المعاينة.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
