-- **المولّد الرقمي المقروء بقى بلا قفل** — ده كان سقف التزامن الحقيقي للحجز كله.
--
-- ## المشكلة المقاسة
--
-- `next_human_readable_number()` كانت بتعمل `INSERT … ON CONFLICT DO UPDATE` على **صف واحد**
-- في `human_readable_sequences` لكل (بادئة + سنة). القفل على الصف ده في Postgres بيفضل ماسك
-- **لحد ما الترانزاكشن اللي نداها يعمل COMMIT** — مش لحد ما الجملة تخلص.
--
-- ولأن `OrdersService.create()` بتنادي المولّد **جوّه** ترانزاكشن الإنشاء الطويلة (تسعير +
-- تحقق + حفظ + عناصر)، النتيجة إن **كل الحجوزات المتزامنة بتتصفّ ورا بعض على صف واحد**، وكل
-- واحدة مستنية ماسكة اتصال من الـpool.
--
-- التشخيص الحي (`scripts/concurrency-booking-safety.js --concurrency 80`) — عيّنة من
-- `pg_stat_activity` أثناء الضغط:
--
--     active | Lock/transactionid | SELECT next_human_readable_number('ORD')
--     active | Lock/transactionid | SELECT next_human_readable_number('ORD')
--     … (كل الاتصالات المفتوحة على نفس السطر)
--
-- الأثر على العميل: ٦٣ من ٨٠ حجز متزامن رجعوا **503**. وزيادة مهلة الحصول على اتصال من ١٠
-- لـ٣٠ ثانية **ماغيّرتش رقم واحد** (نفس الـ١٧ نجحوا) — الدليل القاطع إن ده تسلسل على قفل، مش
-- بطء أو ضغط عابر يتحل بالانتظار.
--
-- ## الحل
--
-- `SEQUENCE` حقيقي بدل صف مقفول. `nextval()` **مش ترانزاكشني**: بياخد قفل خفيف على مستوى
-- الجملة بس وبيسيبه فورًا، فمفيش أي تسلسل بين الحجوزات مهما طالت ترانزاكشناتها.
--
-- **المقايضة المقبولة صراحةً**: `nextval()` مابيرجعش لو الترانزاكشن فشلت، فممكن يحصل **فجوات**
-- في الترقيم (طلب اتلغى وسط الإنشاء بياكل رقم). ده سلوك متعمّد ومقبول: الرقم للقراءة البشرية
-- والتتبّع، مش عدّاد محاسبي. الضمانة اللي تهم — **مفيش رقمين متكررين** — أقوى من الأول.
--
-- الأسماء بتتولّد لكل (بادئة + سنة) عشان الترقيم يفضل بيبدأ من واحد كل سنة زي ما هو دلوقتي.
-- سنة جديدة = إنشاء متأخر (lazy) لأول نداء فيها، تحت قفل استشاري يمنع تصادم نداءين متزامنين.
--
-- `human_readable_sequences` **بيتساب زي ما هو عمدًا** (مش بيتحذف في نفس النشر): هو المرجع
-- التاريخي اللي الـsequences اتبذرت منه، ووجوده بيخلي الرجوع للنسخة القديمة ممكن من غير أي
-- فقدان بيانات. حذفه شغل نشر تاني منفصل بعد ما ده يستقر.

-- (1) بذر sequence لكل عدّاد قائم — بيبدأ من آخر قيمة اتصرفت فعلاً + ١، فمستحيل يتعاد رقم.
DO $$
DECLARE
  r RECORD;
  v_prefix TEXT;
  v_year   TEXT;
  v_seq    TEXT;
BEGIN
  FOR r IN SELECT sequence_key, last_value FROM human_readable_sequences LOOP
    v_prefix := split_part(r.sequence_key, '-', 1);
    v_year   := split_part(r.sequence_key, '-', 2);
    -- نفس حارس الأمان بتاع الدالة تحت: أي مفتاح مش على الشكل المتوقع بيتتخطى بدل ما يتحقن.
    CONTINUE WHEN v_prefix !~ '^[A-Z]{1,10}$' OR v_year !~ '^[0-9]{4}$';
    v_seq := format('hrn_%s_%s', lower(v_prefix), v_year);
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START WITH %s', v_seq, r.last_value + 1);
    -- لو الـsequence كان موجود بالفعل (نسخة قاعدة اتطبق عليها ده قبل كده)، `START WITH`
    -- مابيأثرش — الـ`setval` هنا بيضمن إنه مايبقاش **أقل** من العدّاد القديم بأي حال.
    --
    -- أثر جانبي معروف ومقبول: بيخلّي أول رقم جديد يتخطى واحدًا (آخر رقم اتصرف ١١١٦٩ ⇒ أول
    -- رقم جديد ١١١٧١). فجوة واحدة مرة واحدة لكل بادئة — والفجوات مقبولة أصلاً بقرار فوق،
    -- بينما **تكرار رقم** هو الخطر الحقيقي وده اللي الـ`GREATEST` بيمنعه.
    EXECUTE format('SELECT setval(%L, GREATEST(last_value, %s), true) FROM %I', v_seq, r.last_value, v_seq);
  END LOOP;
END $$;

-- (2) الدالة نفسها — نفس التوقيع ونفس شكل المخرجات بالحرف، الفرق في التخزين بس.
CREATE OR REPLACE FUNCTION next_human_readable_number(p_prefix VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
  v_year VARCHAR(4) := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY');
  v_seq  TEXT;
  v_next BIGINT;
BEGIN
  -- البادئة جاية من ثوابت في الكود، بس الدالة دي بتبني اسم كائن ديناميكي — فالتحقق هنا
  -- حاجز حقن إجباري مش تجميل.
  IF p_prefix !~ '^[A-Z]{1,10}$' THEN
    RAISE EXCEPTION 'بادئة رقم غير صالحة: %', p_prefix;
  END IF;

  v_seq := format('hrn_%s_%s', lower(p_prefix), v_year);

  BEGIN
    EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_next;
  EXCEPTION WHEN undefined_table THEN
    -- أول نداء لبادئة/سنة جديدة. القفل الاستشاري بيخلي نداءين متزامنين ينشئوا مرة واحدة بس.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_seq, 0));
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq);
    EXECUTE format('SELECT nextval(%L)', v_seq) INTO v_next;
  END;

  RETURN p_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
END;
$$;
