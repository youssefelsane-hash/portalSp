-- عتبة اعتبار الـmatching workflow متأخرًا.
--
-- الفرق عن `stale_dispatch` الموجود: ده بيولّع لكل عرض عدّى `expires_at` — وده **سلوك طبيعي**
-- في النظام (ADR-0018 §5: العرض بيفضل صالح بعدها، و`expires_at` معناها «وقت توسيع البث» بس).
-- يعني التنبيه القديم بيولّع حتى والـworkflow سليم تمامًا والجولة الجاية اتعملت في وقتها.
--
-- التأخير الحقيقي هو: عدّى وقت التوسيع، **والجولة الجاية ما اتعملتش**، والطلب لسه بيدوّر.
-- المهلة دي بتدي الـqueue فرصة معالجة طبيعية قبل ما نقول «متأخر».

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.workflow_delay_grace_seconds', '60', 'number', 'matching',
   'مهلة السماح قبل اعتبار توسيع جولة المطابقة متأخرًا — بتتحسب بعد وقت التوسيع المفروض',
   false)
ON CONFLICT (key) DO NOTHING;
