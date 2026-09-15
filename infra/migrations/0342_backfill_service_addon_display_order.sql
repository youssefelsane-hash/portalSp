-- Osta — 0342: ترقيم الإضافات الاختيارية القديمة (نفس فئة 0341 بالظبط).
--
-- `createAddon` كانت بتحط `display_order = 0` لأي إضافة الأدمن ما حددش لها رقم، فكل إضافات
-- الخدمة بتبقى أصفار — ولما الأدمن يحط على واحدة «١» تنزل آخر واحدة بدل ما تطلع فوق. نفس
-- البلاغ اللي اتصلح لحقول الفورم في 0341، ونفس القاعدة: الخدمات اللي كل إضافاتها على نفس
-- الرقم بتترقّم ١..ن بترتيب إضافتها، واللي فيها ترتيب متباين حقيقي مابتتلمسش.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY service_id ORDER BY created_at ASC, id ASC) AS position
  FROM service_addons
  WHERE deleted_at IS NULL
    AND service_id IN (
      SELECT service_id
      FROM service_addons
      WHERE deleted_at IS NULL
      GROUP BY service_id
      HAVING COUNT(DISTINCT display_order) = 1
    )
)
UPDATE service_addons AS a
SET display_order = ranked.position
FROM ranked
WHERE a.id = ranked.id
  AND a.display_order IS DISTINCT FROM ranked.position;
