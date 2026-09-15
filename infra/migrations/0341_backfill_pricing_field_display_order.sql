-- Osta — 0341: ترقيم حقول التسعير القديمة بدل ما تبقى كلها صفر.
--
-- ## البلاغ
--
-- «بحط حقل رقم واحد بقى يظهر رقم عشرة» — بلاغ المالك (2026-09-15، docs/08 §149).
--
-- ## السبب
--
-- `PricingFieldsService.create()` كانت بتحط `display_order = 0` لأي حقل الأدمن ما حددش له
-- رقم (والأدمن عمليًا مابيحددش). فكل حقول الخدمة بتبقى أصفار، ولما الأدمن يجي يقول «الحقل ده
-- يبقى الأول» ويكتب **١**، الرقم ١ بيبقى **أكبر** من كل الأصفار فالحقل بينزل **آخر واحد**
-- بدل ما يطلع فوق. الخاصية كانت شغالة بالعكس تمامًا.
--
-- الكود اتصلح (الحقل الجديد بياخد `MAX + 1`)، بس ده بيصلّح الجديد بس — الخدمات الموجودة
-- حقولها لسه كلها أصفار، فلازم ترقيم رجعي هنا.
--
-- ## القاعدة
--
-- الخدمات اللي **كل** حقولها على نفس الرقم (الحالة المكسورة: كلهم صفر) بترقّم ١..ن بترتيب
-- إضافتها الأصلي — وده الترتيب اللي الأدمن كان شايفه فعلًا على الشاشة، فمفيش أي حركة مفاجئة
-- في شكل الفورم عند العميل. الخدمات اللي فيها ترتيب حقيقي متباين (حد ظبطه بإيده) **مابتتلمسش
-- خالص**.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY service_id ORDER BY created_at ASC, id ASC) AS position
  FROM service_pricing_fields
  WHERE deleted_at IS NULL
    AND service_id IN (
      SELECT service_id
      FROM service_pricing_fields
      WHERE deleted_at IS NULL
      GROUP BY service_id
      HAVING COUNT(DISTINCT display_order) = 1
    )
)
UPDATE service_pricing_fields AS f
SET display_order = ranked.position
FROM ranked
WHERE f.id = ranked.id
  AND f.display_order IS DISTINCT FROM ranked.position;
