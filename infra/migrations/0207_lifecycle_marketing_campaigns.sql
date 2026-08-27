-- baytak — 0207: محرك حملات التسويق ودورة حياة العميل (ADR-0046، docs/08 §74-أ)
--
-- طلب المالك (2026-08-27): «عايزين كل كام يوم الأبليكيشن يبعت notification، وكل مرة مختلف… زي
-- الإعلانات اللي بتيجي أوتوماتيك… ولو حد بص على خدمة وما كمّلش، بعد ساعة يقوله الخدمة دي موجودة…
-- بس الأدمن يبقى عنده access يقول إيه اللي يظهر وإيه اللي ما يظهرش».
--
-- الميزة دي **تسويقية بحتة ومعزولة**: موديول `campaigns` بيستهلك NotificationsService من برّه.
-- مفيش سطر واحد بيتغيّر في orders/matching/payments — أسوأ فشل ممكن هنا هو إن إعلان ما اتبعتش.

-- ═══ 1) الخدمة اللي بيتعلن عنها = اختيار الأدمن الصريح ═══
-- مخاوف المالك حرفيًا: «ممكن تبقى خدمة إحنا أصلاً ما نظفناهاش». الافتراضي `false` مقصود —
-- بعد الـmigration مفيش أي خدمة بتتعلن لحد ما الأدمن يعلّم اللي جاهزة بإيده. الاتجاه الآمن:
-- خدمة اتنسيت = إعلان أقل، مش إعلان غلط.
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_promotable BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN services.is_promotable IS
  'الأدمن سامح للمنصة تعمل إعلان تلقائي للخدمة دي؟ (ADR-0046). افتراضي false — لازم تفعيل صريح.';

CREATE INDEX IF NOT EXISTS idx_services_promotable
  ON services (category_id) WHERE is_promotable = true AND is_active = true AND deleted_at IS NULL;

-- إلغاء اشتراك تسويقي **مستقل** عن إشعارات الطلبات — العميل يقفل الإعلانات من غير ما يفقد
-- إشعارات "الفني في الطريق". مطلب قانوني في أغلب الأسواق وممارسة أساسية.
ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS marketing_opt_out BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN customer_profiles.marketing_opt_out IS
  'العميل قفل الإشعارات التسويقية (ADR-0046). مستقل تمامًا عن تفضيلات قنوات إشعارات الطلبات.';

-- ═══ 2) الحملات — قوالب يكتبها الأدمن ═══
CREATE TABLE IF NOT EXISTS notification_campaigns (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- 'periodic_promo' | 'abandoned_intent'. نصّي مش enum قاعدة: إضافة نوع تالت بعدين ما تحتاجش
  -- migration على enum ولا إعادة نشر متزامنة.
  campaign_type         VARCHAR(40)  NOT NULL,
  name                  VARCHAR(120) NOT NULL,
  -- القالب: نص فيه متغيّرات {{service_name}} / {{category_name}} / {{customer_name}}. الأدمن
  -- بيكتب رسالة واحدة والمحرك بيطلّع منها عشرات الرسايل بأسماء خدمات حقيقية — ده اللي بيحل
  -- «كل مرة مختلف» من غير ما الأدمن يكتب مية رسالة.
  title_template_ar     VARCHAR(160) NOT NULL,
  body_template_ar      TEXT         NOT NULL,
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  -- أقل عدد أيام بين إرسالين من **نفس** الحملة لنفس العميل.
  cooldown_days         SMALLINT     NOT NULL DEFAULT 4,
  -- ترتيب الاختيار لما أكتر من حملة مؤهلة في نفس اللحظة (الأعلى الأول).
  priority              SMALLINT     NOT NULL DEFAULT 100,
  -- لـ'abandoned_intent': بعد كام دقيقة من الاهتمام المتروك نبعت. NULL للأنواع التانية.
  trigger_delay_minutes INTEGER,
  -- تقييد اختياري على فئة معيّنة — NULL = كل الفئات.
  category_id           UUID         REFERENCES service_categories(id),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT chk_campaign_type CHECK (campaign_type IN ('periodic_promo', 'abandoned_intent')),
  CONSTRAINT chk_campaign_cooldown CHECK (cooldown_days BETWEEN 1 AND 90)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_active
  ON notification_campaigns (campaign_type, priority DESC) WHERE is_active = true AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON notification_campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON notification_campaigns
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══ 3) سجل الإرسال — مصدر واحد للتكرار وللتحليل ═══
-- ده **مش لوج**: هو اللي بيتبني عليه سقف التكرار والـcooldown، **وكمان** اللي الأدمن بيشوف منه
-- أداء كل حملة. حاجة واحدة بتخدم غرضين ⇒ مفيش عدّاد موازي ممكن يفرق عن الواقع.
CREATE TABLE IF NOT EXISTS notification_campaign_sends (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  campaign_id   UUID        NOT NULL REFERENCES notification_campaigns(id),
  user_id       UUID        NOT NULL REFERENCES users(id),
  -- الخدمة اللي اتعلن عنها فعليًا في الرسالة دي — بيخلّي التحليل ممكن ("أنهي خدمة بتجيب طلبات؟").
  service_id    UUID        REFERENCES services(id),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الفهرس ده بيخدم الاستعلامين اللي بيتنفّذوا كل sweep: "آخر إرسال من الحملة دي للعميل ده"
-- (cooldown) و"كام إرسال للعميل ده في آخر أسبوع" (السقف العام).
CREATE INDEX IF NOT EXISTS idx_campaign_sends_user_time
  ON notification_campaign_sends (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign_user
  ON notification_campaign_sends (campaign_id, user_id, sent_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON notification_campaign_sends;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON notification_campaign_sends
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══ 4) الاهتمام المتروك — إشارة صريحة من التطبيق ═══
-- **ليه مش استنتاج من الطلبات الملغية؟** الطلب الملغي حالة تانية خالص (العميل حجز فعلاً وبعدين
-- لغى — ده استرجاع بعد فشل وله رسالة مختلفة). اللي المالك وصفه هو اللي **ما وصلش لطلب أصلاً**،
-- وده مالوش أي أثر في قاعدة البيانات دلوقتي.
CREATE TABLE IF NOT EXISTS customer_service_intents (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID        NOT NULL REFERENCES users(id),
  service_id   UUID        NOT NULL REFERENCES services(id),
  -- 'viewed_service' | 'started_booking' — كل ما الخطوة أعمق، النية أقوى.
  intent_stage VARCHAR(30) NOT NULL DEFAULT 'viewed_service',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- اتعامل معاه المحرك (اتبعت/اتجاهل)؟ بيمنع إعادة معالجة نفس الاهتمام.
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_intent_stage CHECK (intent_stage IN ('viewed_service', 'started_booking'))
);

-- الفهرس الجزئي ده هو اللي بيخلّي الـsweep رخيص: بيمسح الصفوف اللي لسه ما اتعالجتش بس، مش
-- الجدول كله.
CREATE INDEX IF NOT EXISTS idx_service_intents_unprocessed
  ON customer_service_intents (occurred_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_intents_user
  ON customer_service_intents (user_id, service_id, occurred_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON customer_service_intents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON customer_service_intents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══ 5) حواجز الحماية — مفاتيح إعداد مش أرقام مدفونة ═══
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('campaigns.enabled', 'true', 'boolean', 'campaigns',
   'تشغيل/إيقاف محرك الحملات التسويقية بالكامل. إقفالها بيوقّف كل الإعلانات التلقائية فورًا بلا أي أثر على إشعارات الطلبات.', false),
  ('campaigns.max_per_customer_per_week', '2', 'number', 'campaigns',
   'أقصى عدد إشعارات تسويقية للعميل الواحد في الأسبوع — **فوق كل الحملات مجتمعة**. أهم حاجز ضد السبام: مهما فعّل الأدمن حملات، السقف ده بيحكمهم كلهم.', false),
  ('campaigns.periodic_interval_days', '4', 'number', 'campaigns',
   'كل كام يوم يتبعت إعلان دوري للعميل الواحد (لو مفيش مانع تاني).', false),
  ('campaigns.abandoned_intent_delay_minutes', '60', 'number', 'campaigns',
   'بعد كام دقيقة من "العميل بص على خدمة وما حجزش" يتبعت التذكير. القيمة على الحملة نفسها بتغلب دي لو متحددة.', false),
  ('campaigns.quiet_hours_start', '"21:00"', 'string', 'campaigns',
   'بداية ساعات الهدوء للإعلانات (UTC) — مفيش إعلان جوّه النطاق ده. أوسع من ساعات هدوء الطلبات عمدًا: الإعلان مالوش أي استعجال.', false),
  ('campaigns.quiet_hours_end', '"06:00"', 'string', 'campaigns',
   'نهاية ساعات الهدوء للإعلانات (UTC).', false),
  ('campaigns.inactive_customer_days', '90', 'number', 'campaigns',
   'العميل اللي ما دخلش من أكتر من كده ما بياخدش إعلانات — حساب ميت، والإرسال ليه بيضر سمعة المُرسِل.', false),
  ('campaigns.sweep_batch_size', '200', 'number', 'campaigns',
   'أقصى عدد إشعارات تسويقية في الدورة الواحدة — بيمنع أي دفعة ضخمة مفاجئة.', false)
ON CONFLICT (key) DO NOTHING;

-- ═══ 6) قوالب مزروعة جاهزة ═══
-- الميزة بتشتغل من أول يوم بلا شغل إداري، والأدمن يعدّل براحته. النصوص بالعامية المصرية زي
-- باقي رسايل المنصة.
INSERT INTO notification_campaigns (campaign_type, name, title_template_ar, body_template_ar, cooldown_days, priority, trigger_delay_minutes)
SELECT * FROM (VALUES
  ('periodic_promo', 'إعلان عام — خدمة عشوائية',
   'محتاج {{service_name}}؟',
   'فنيين صُنّاع موجودين في منطقتك. اطلب {{service_name}} دلوقتي والفني يوصلك في المعاد اللي يناسبك.',
   4::smallint, 100::smallint, NULL::integer),
  ('periodic_promo', 'إعلان صيانة — حاجة عايزة تتصلح',
   'عندك حاجة عايزة تتصلح؟',
   'بدل ما تأجّلها تاني — {{service_name}} بفني متخصص وبسعر واضح قبل ما يبدأ. اطلب دلوقتي.',
   6::smallint, 90::smallint, NULL::integer),
  ('periodic_promo', 'إعلان تنظيف — البيت',
   'محتاج حد ينضّفلك البيت؟',
   '{{service_name}} بفريق متدرّب وبأدوات جاهزة. احجز المعاد اللي يريحك وسيب الباقي علينا.',
   7::smallint, 80::smallint, NULL::integer),
  ('abandoned_intent', 'استرجاع — بصّيت وما حجزتش',
   'لسه فاكر {{service_name}}؟',
   'الخدمة لسه موجودة وفنيينا متاحين. لو محتاج تعرف السعر الأول، ادخل وشوف التفاصيل من غير أي التزام.',
   2::smallint, 200::smallint, 60::integer)
) AS seed(campaign_type, name, title_template_ar, body_template_ar, cooldown_days, priority, trigger_delay_minutes)
WHERE NOT EXISTS (SELECT 1 FROM notification_campaigns);
