-- طلب مراجعة Google (docs/10 بند 40) — كان مؤجّل عمدًا كـbacklog. بعد أي تقييم عميل عالي
-- (>= الحد الأدنى)، الباك-إند بيقترح على العميل يقيّم على Google كمان برابط حقيقي — مفيش
-- إزعاج للعملاء اللي قيّموا منخفض (مفيش داعي نوجّههم لمراجعة عامة سلبية، الأفضل يتوجهوا للدعم).

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('reviews.google_review_url', '""', 'string', 'reviews', 'رابط صفحة تقييم Google الحقيقي (Google Business Profile) — فاضي = الاقتراح متوقف تلقائيًا لحد ما يتحط', false),
  ('reviews.min_rating_for_google_prompt', '4', 'number', 'reviews', 'أقل overall_rating (من 5) عشان نقترح على العميل يقيّم على Google كمان', false);
