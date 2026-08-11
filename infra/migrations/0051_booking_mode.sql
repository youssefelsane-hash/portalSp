-- baytak (صُنّاع) — 0051: هيكل الحجز الجديد — فرد/فريق (اعتماد)/طوارئ (docs/06 §0-1، docs/07 الجزء أ)
-- المالك طلب صراحة إن العميل يختار قبل حتى ما يشوف الخدمة: "أفراد" (شغل سريع) / "اعتماد" (فريق/شركة)
-- / "طوارئ" (حجز فوري بسعر بريميوم). قرار معماري لفجوة موثّقة (docs/07 §ب#1): مش قايمة كاتيجوريز
-- منفصلة — نفس services الموجودة، كل خدمة بتعلن أي أوضاع بتدعمها عبر allows_individual/allows_team،
-- بالظبط زي allows_scheduling/allows_emergency الموجودين بالفعل. orders.booking_mode بيسجّل اختيار
-- العميل الفعلي وقت الحجز — منفصل عن order_type الموجود (محور تاني: standard/scheduled/recurring/b2b/
-- emergency)؛ orders.service.ts بيزامن order_type=emergency تلقائياً لو booking_mode='emergency' عشان
-- أي كود قديم بيقرا order_type يفضل شغال صح، بدل ما نستبدله.
CREATE TYPE booking_mode AS ENUM ('individual', 'team', 'emergency');

ALTER TABLE services ADD COLUMN allows_individual BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE services ADD COLUMN allows_team BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE orders ADD COLUMN booking_mode booking_mode NOT NULL DEFAULT 'individual';

-- لو العميل اختار "اعتماد" وحدد شركة/فريق بعينه بدل ما يسيب المطابقة تختار — تفضيل بس مش ضمان،
-- نفس فلسفة requested_technician_id (0046).
ALTER TABLE orders ADD COLUMN requested_technician_company_id UUID NULL REFERENCES technician_companies(id);
