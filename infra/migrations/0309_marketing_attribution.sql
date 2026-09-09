-- إسناد التسويق: مصدر واحد لكل إعلان، ورابط واحد بيوزّع حسب الجهاز (ADR-0082، docs/08 §135).
--
-- **الفجوة اللي بيقفلها**: `marketing_spend` بيسجّل الصرف الشهري لكل قناة من زمان، لكن مفيش أي
-- رقم **مقابله** — مفيش حاجة بتربط «إعلان بعينه» بـ«عميل بعينه». يعني الصرف موجود والنتيجة
-- مجهولة، والقرار «أزوّد في الإعلان ده ولا لأ» بيتاخد بالإحساس.
--
-- **جدول واحد لكل القنوات مش جدول لكل قناة**: بوستر وإنفلونسر وبواب وحملة فيسبوك كلهم صف واحد
-- بكود قصير. القنوات بتتغيّر (بكرة تيك توك ومعارض)، وجدول لكل قناة معناه migration وكود مع كل
-- قناة جديدة. صف واحد معناه إن قناة جديدة = **إدخال بيانات من الأدمن**.

-- ═══ ١) مصادر التسويق ═══
CREATE TABLE marketing_sources (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- الكود ده بيتطبع على ملصق ويعيش شهور: قصير، بحروف كبيرة، وبلا الحروف اللي بتتلخبط
  -- في القراءة اليدوية (0/O، 1/I) — نفس قاعدة `users.referral_code`.
  code varchar(24) NOT NULL,
  name_ar varchar(120) NOT NULL,
  channel varchar(30) NOT NULL,
  -- «الـQR ده تبع منطقة إيه» (طلب المالك) — نص حر عن قصد مش FK على `service_zones`:
  -- الحملة ممكن تكون على منطقة مش متعرّفة عندنا كنطاق خدمة أصلاً («سموحة»، «معرض القاهرة»).
  region_label varchar(120),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  -- عمولة البواب: صفر/NULL = مصدر تتبّع بس بلا أي مستحقات.
  payout_per_completed_order_cents integer NOT NULL DEFAULT 0,
  payout_contact_name varchar(120),
  payout_contact_phone varchar(20),
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_marketing_source_payout_non_negative CHECK (payout_per_completed_order_cents >= 0)
);

-- الكود فريد بين المصادر **الحيّة** بس: مصدر متحذف (soft delete) ماينفعش يمنع إعادة استخدام
-- كود اتحرق، ولا ينفع يفضل شايل الكود للأبد.
CREATE UNIQUE INDEX uq_marketing_sources_code_alive ON marketing_sources (code) WHERE deleted_at IS NULL;
CREATE INDEX idx_marketing_sources_channel ON marketing_sources (channel) WHERE deleted_at IS NULL;

-- ═══ ٢) زيارات الرابط ═══
--
-- **زيارة مش شخص، وده مقصود**: طلب المالك بالحرف «مش الشخص ده تحذيرة، ولكن كم واحد سكان».
-- فمفيش IP ولا معرّف جهاز ولا كوكي هنا — العمود الوحيد اللي بيوصف الزائر هو المنصة المستنتجة
-- من `User-Agent` (أندرويد/iOS/ويب)، وهي اللي بتخلّي «التحويل للمتجر الصح» قابل للقياس.
-- نتيجتها إن الرقم **زيارات** مش أشخاص (نفس الشخص يفتح مرتين = ٢)، ومكتوبة كده في اللوحة.
CREATE TABLE marketing_link_hits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  source_id uuid NOT NULL REFERENCES marketing_sources(id),
  platform varchar(10) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_marketing_hit_platform CHECK (platform IN ('android', 'ios', 'web', 'other'))
);

CREATE INDEX idx_marketing_link_hits_source_time ON marketing_link_hits (source_id, occurred_at DESC);
-- التقرير بيجمّع على المدى الزمني قبل ما يقسّم بالمصدر، فالفهرس ده هو اللي بيخدمه.
CREATE INDEX idx_marketing_link_hits_time ON marketing_link_hits (occurred_at DESC);

-- ═══ ٣) الإسناد: أول لمسة، ودايم ═══
--
-- صف واحد لكل مستخدم (`UNIQUE`) — أول مصدر بيكسب ويفضل. نفس المبدأ المطبّق فعلاً في
-- `users.referred_by_user_id` و`technician_referral_attributions`، عشان مايبقاش في المنتج
-- تلات قواعد إسناد مختلفة بتدّي تلات إجابات لنفس السؤال.
CREATE TABLE marketing_attributions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  source_id uuid NOT NULL REFERENCES marketing_sources(id),
  attributed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_marketing_attributions_source ON marketing_attributions (source_id) WHERE deleted_at IS NULL;

-- ═══ ٤) مستحقات البواب ═══
--
-- **مفيش قيد محفظة تلقائي هنا، وده قرار موثّق في ADR-0082 §5**: القيد التلقائي محتاج البواب
-- يبقى عنده حساب ومحفظة (onboarding كامل)، وشبكة البوابين بتتدفع كاش عمليًا. الصف ده بيدّي
-- الأدمن رقم مستحق **دقيق** لكل مصدر، والصرف بيتم بمسار الصرف الموجود. لما تبان الحاجة
-- للأتمتة، محرك `technician-referrals` (المختبر والمحصّن ضد الاحتيال والتكرار) هو اللي
-- هيتوسّع — مش مسار فلوس تاني.
--
-- `UNIQUE(order_id)` هو حارس الـidempotency: حدث اكتمال الطلب ممكن يتكرر (إعادة تشغيل،
-- نسختين، sweep استرداد)، والقيد ده بيخلّي التكرار مايولّدش مستحق تاني على نفس الشغلانة.
CREATE TABLE marketing_source_commissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  source_id uuid NOT NULL REFERENCES marketing_sources(id),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  customer_user_id uuid NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'accrued',
  accrued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  paid_by_user_id uuid REFERENCES users(id),
  payment_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_marketing_commission_status CHECK (status IN ('accrued', 'paid', 'cancelled')),
  CONSTRAINT chk_marketing_commission_amount CHECK (amount_cents > 0),
  -- الحالة والتوقيت لازم يتفقوا: «مدفوع» بلا تاريخ دفع بيخلّي أي تقرير مستحقات يكذب.
  CONSTRAINT chk_marketing_commission_paid_at CHECK (
    (status = 'paid' AND paid_at IS NOT NULL) OR (status <> 'paid' AND paid_at IS NULL)
  )
);

CREATE INDEX idx_marketing_commissions_source_status ON marketing_source_commissions (source_id, status) WHERE deleted_at IS NULL;

-- ═══ ٥) إعدادات وجهة الرابط وعرض أول طلب ═══
--
-- **الوجهة في الإعدادات مش في الـQR**: الملصق بيتطبع مرة واحدة ويعيش شهور. لو الـQR بيوصل
-- لجوجل بلاي مباشرةً، أي تغيير (متجر جديد، صفحة هبوط، حملة موقوفة) = إعادة طباعة كل الملصقات.
INSERT INTO settings (key, value, value_type, group_name, description, is_public)
SELECT v.key, v.value::jsonb, v.value_type, 'marketing', v.description, v.is_public
FROM (VALUES
  ('marketing.android_store_url', '""', 'string',
   'رابط التطبيق على Google Play. لما يكون فاضي، زوّار الأندرويد بيروحوا لصفحة الويب بدل ما يوصلوا لصفحة مكسورة.', true),
  ('marketing.ios_store_url', '""', 'string',
   'رابط التطبيق على App Store. نفس السلوك لو فاضي.', true),
  ('marketing.web_landing_url', '""', 'string',
   'صفحة الهبوط على الويب — الوجهة الافتراضية لأي جهاز، والبديل لما رابط المتجر مايكونش متسجّل. فاضي = الرجوع لعنوان تطبيق الويب من متغيّرات البيئة.', true),
  ('marketing.first_order_offer_enabled', 'false', 'boolean',
   'تفعيل عرض خصم أول طلب. مقفول افتراضيًا عن قصد: العرض بيصرف فلوس حقيقية، فتشغيله لازم يكون قرار صريح مش نتيجة migration.', false),
  ('marketing.first_order_discount_cents', '10000', 'integer',
   'قيمة خصم أول طلب بالقرش (١٠٠ ج.م افتراضيًا).', false),
  ('marketing.first_order_min_order_cents', '30000', 'integer',
   'أقل قيمة طلب يشتغل عليها الخصم بالقرش (٣٠٠ ج.م افتراضيًا) — بيمنع إن الخصم يبلع الطلب كله.', false),
  ('marketing.first_order_validity_days', '30', 'integer',
   'صلاحية كود أول طلب بالأيام من لحظة إصداره.', false),
  ('marketing.first_order_message_ar', '"معاك خصم {discount} ج.م على أول طلب — بحد أدنى {min_order} ج.م."', 'string',
   'نص رسالة عرض أول طلب. `{discount}` و`{min_order}` بيتبدّلوا بالقيم الفعلية وقت الإرسال، فتغيير المبلغ مايسيبش نص قديم بيكذب.', false),
  ('marketing.referral_invite_message_ar', '"رشّح صاحبك واكسبوا الاتنين — هو ياخد خصم على أول طلب وإنت تاخد خصم لما طلبه يخلص."', 'string',
   'نص دعوة الترشيح اللي بيظهر للعميل بعد أول طلب.', false)
) AS v(key, value, value_type, description, is_public)
WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = v.key);
