-- نوع إشعار «الطلب اتدفع أونلاين والشغل لسه شغّال» (ADR-0091 §8).
--
-- 0087 قرّرت صراحةً إن كل notification_type موجود في الكود لازم يكون له صف هنا — صفر hardcode
-- للأولوية/الصوت/القناة. النوع ده بيوصل للفني وهو في الشارع وبيغيّر سلوكه (مش هيحصّل كاش)،
-- فالقناة الافتراضية push + in_app زي باقي إشعارات التنفيذ، والأولوية informational لأنه خبر
-- مش إجراء مطلوب منه.

INSERT INTO notification_type_configs (notification_type, priority_tier)
VALUES ('order_prepaid_online', 'informational')
ON CONFLICT (notification_type) DO NOTHING;
