-- baytak — 0191: أولوية معتدلة للشركات المسجلة في شغل الفرق الكبيرة.
--
-- الشركة لا تتخطى بوابات الخدمة/المنطقة/التوفر/المستوى. الزيادة تدخل rank_score فقط عندما
-- يكون الطلب TEAM وحجم الطاقم المطلوب بلغ العتبة، والشركة مسجلة وعندها عدد كافٍ من الأعضاء
-- المؤهلين لنفس الخدمة والمنطقة والموعد. القيم قابلة للتعديل من إعدادات الأدمن.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.company_large_job_min_crew', '4', 'number', 'matching',
   'أقل إجمالي أفراد مطلوب في طلب فريق قبل تطبيق أفضلية الشركة المسجلة (افتراضي 4)', false),
  ('matching.company_large_job_boost', '3', 'number', 'matching',
   'زيادة معتدلة في ترتيب ممثل الشركة المسجلة للشغل الكبير عند كفاية طاقمها (0 = تعطيل)', false)
ON CONFLICT (key) DO NOTHING;
