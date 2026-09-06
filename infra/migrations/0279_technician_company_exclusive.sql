-- ADR-0080 — «حصري للشركة» (طلب مالك صريح، 2026-09-06).
--
-- «عايز زرار عند كل فني داخل في شركة… الزرار ده لو متفعل، الفني ده ما بيظهرش أصلًا إن هو فرد
--  لوحده، يعني ما بيظهرش، كأنه مش متسجل معانا، هو فقط تابع للشركة، يعني بيتم اختياره فقط عن
--  طريق الشركة بتاعته. إنما لو الزرار ده متعطل عادي الراجل ده بيبقى زيه زي أي حد متسجل عندنا.»
--
-- العلم ده **مش** حالة تحقق ولا إيقاف: الفني معتمد وشغّال بالكامل، بس مسار وصوله للشغل واحد
-- بس — شركته. الافتراضي false عمدًا: صفر تغيير سلوك لأي فني قائم.
--
-- بيتفرض على مستوى القاعدة إنه مالوش معنى لفني مستقل: مينفعش يبقى «حصري لشركة» وهو مش في شركة.

ALTER TABLE technician_profiles
  ADD COLUMN company_exclusive boolean NOT NULL DEFAULT false;

ALTER TABLE technician_profiles
  ADD CONSTRAINT chk_technician_profiles_company_exclusive_needs_company CHECK (
    company_exclusive = false OR company_id IS NOT NULL
  );

-- الفلترة الأكتر تكرارًا: «أظهر لي الأفراد الظاهرين» — فهرس جزئي على الاستثناء (النادر) بدل
-- فهرس كامل على عمود قيمته false في كل الصفوف تقريبًا.
CREATE INDEX idx_technician_profiles_company_exclusive
  ON technician_profiles (company_id) WHERE company_exclusive = true;
