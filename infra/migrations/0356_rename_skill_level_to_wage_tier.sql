-- **`skill_level` بقى `technician_wage_tier`** (طلب مالك 2026-09-19، docs/08 §172).
--
-- §171 فكّت اللبس على شاشة الأدمن (فئة سعر الفني ↔ درجة أجر المهارة كانوا بنفس التلات كلمات)،
-- بس الاسم جوّه القاعدة فضل `skill_level` — اسم عام مش بيقول إنه عن **الأجر**، وجنبه
-- `technician_pricing_tier` اللي عن **سعر العميل**. أي حد بيقرا الاتنين لأول مرة بيتلخبط، وده
-- كود بيحدد فلوس ناس حقيقية.
--
-- ### ليه ده آمن (اتقاس، مش افتراض)
--
-- كل العمليات تحت **على البيانات الوصفية بس**: `ALTER TYPE … RENAME` و`ALTER TABLE … RENAME
-- COLUMN` في Postgres مابيعيدوش كتابة ولا صف واحد، والقيم المخزّنة زي ما هي بالحرف
-- (`beginner/standard/expert`). القيود والفهارس بتتحدّث تعريفاتها تلقائيًا، بما فيها
-- `chk_order_earning_shares_v2_complete_snapshot` اللي بيشاور على عمود اللقطة بالاسم.
--
-- ### اللي **ما**اتغيّرش عن قصد
--
-- **عقد الـAPI بالكامل**: حقول `skill_level` و`service_skill*` في الـrequests/responses
-- والمسارات `/admin/earnings-policy/skills/…` زي ما هي. الـDTOs بقت بتعمل mapping صريح من
-- الاسم الجديد جوّه للاسم القديم على السلك — كسر العقد مكانش مطلوب ومالوش أي عائد هنا.
--
-- وأسماء الجداول (`earnings_skill_policy`, `service_earnings_skill_overrides`) اتسابت كمان:
-- إعادة تسميتها بتلمس أسماء القيود والفهارس المشتقّة منها بلا أي مكسب على الوضوح.

ALTER TYPE skill_level RENAME TO technician_wage_tier;

ALTER TABLE technician_services RENAME COLUMN skill_level TO wage_tier;
ALTER TABLE earnings_skill_policy RENAME COLUMN skill_level TO wage_tier;
ALTER TABLE service_earnings_skill_overrides RENAME COLUMN skill_level TO wage_tier;
ALTER TABLE order_earning_shares RENAME COLUMN service_skill_snapshot TO service_wage_tier_snapshot;
ALTER TABLE order_earning_shares
  RENAME COLUMN service_skill_factor_bps_snapshot TO service_wage_factor_bps_snapshot;
