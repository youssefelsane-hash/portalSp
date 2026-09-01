-- baytak (صُنّاع) — 0241: السقف اليومي بالساعات بدل قاعدة «شاغل يوم كامل» (ADR-0059).
--
-- `matching.full_day_job_minutes` (migration 0146) كان بوليان تقريبي: «الشغلانة دي كبيرة كفاية
-- إنها تقفل اليوم؟». القاعدة دي كانت غير متماثلة (بتدّي إجابة مختلفة حسب مين بيسأل — بلاغ مالك
-- موثّق في ADR-0059) وكانت بتشوف الشغل الممتد على يوم بدايته بس.
--
-- بدلها: مجموع الدقايق المشغولة فعليًا في كل يوم مقابل سقف يومي. الإعداد القديم بيتشال لأن
-- وجود الاتنين معناه مصدرين لنفس القرار.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.daily_capacity_minutes', '720', 'number', 'matching',
   'أقصى دقايق شغل للفني في اليوم الواحد (720 = 12 ساعة). لو المحجوز في اليوم + الشغلانة الجديدة عدّى الرقم ده، الفني مايترشّحش لليوم ده.',
   false)
ON CONFLICT (key) DO NOTHING;

DELETE FROM settings WHERE key = 'matching.full_day_job_minutes';
