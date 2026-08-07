# modules/orders

الطلبات ودورة حياتها الكاملة (state machine مقفولة). جداول: orders, order_status_history, order_items, order_media, order_assignments, cancellation_reasons (قاموس §6). الجدول الأخطر في النظام كله.

**الحالة: شغال جزئياً (S3) — الإنشاء والإلغاء بس.**

- `order-state-machine.ts`: مصدر الحقيقة الوحيد لانتقالات الحالة الكاملة (كل الـ 18 حالة من القاموس §6.2)، مقفولة تماماً — أي انتقال مش معرّف فيها يرمي `ORDR_003`. مبنية كاملة من الأول رغم إن دلوقتي بيتستخدم منها بس الإنشاء (`draft`→`searching_technician`) والإلغاء، عشان موديولات `matching`/`payments`/`support` الجاية تستخدم نفس الملف من غير ما تتلمس تاني.
- `POST /orders`: بيتحقق من ملكية العنوان، الخدمة نشطة، فيه نطاق خدمة للمدينة (`ORDR_001` لو لأ)، بيحسب السعر التقديري عبر `catalog`، وبيولّد `order_number` من `next_human_readable_number('ORD')` — كل ده جوّه transaction واحدة مع أول صف في `order_status_history`.
- `POST /orders/:id/cancel`: بيتحقق إن الحالة الحالية لسه قابلة للإلغاء من العميل (قبل ما الفني يوصل)، وبيرفض أي محاولة إلغاء تانية على طلب اتلغى قبل كده.
- `GET /orders`, `GET /orders/:id`: للعميل صاحب الطلب بس.
- اتعمله اختبار end-to-end فعلي كامل: إنشاء طلب حقيقي → ظهوره في القايمة والتفاصيل → صف في `order_status_history` → إلغاء ناجح → محاولة إلغاء تانية اترفضت صح (`ORDR_003`, HTTP 409) → فني اتمنع من مسار العميل (403).
- لسه من غير: `order_items`, `order_media`, `order_assignments` (موديول `matching`)، تعديل السعر، الشكاوى، الفواتير.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
