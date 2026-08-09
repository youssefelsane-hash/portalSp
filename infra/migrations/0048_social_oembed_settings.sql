-- baytak — 0048: إعداد اختياري لمفتاح Facebook Graph API (لازم لجلب oEmbed لينكات انستجرام/فيسبوك)
-- تيك توك ويوتيوب عندهم oEmbed عام بلا مفتاح، بس انستجرام/فيسبوك بقى محتاج access token حقيقي
-- من تطبيق Facebook Developer (تفاصيل الحصول عليه في docs/03-external-integrations.md). فاضي
-- دلوقتي — لينكات انستجرام/فيسبوك هتتحفظ عادي بس من غير thumbnail لحد ما يتحط.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('social.facebook_graph_access_token', '""', 'string', 'social', 'مفتاح Facebook Graph API لجلب معاينات لينكات انستجرام/فيسبوك (oEmbed)', false);
