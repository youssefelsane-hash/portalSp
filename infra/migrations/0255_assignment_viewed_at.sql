-- baytak (صُنّاع) — 0255: لحظة مشاهدة العرض (Admin Operations Observability).
--
-- `order_assignments.assignment_status` بيقدر يبقى 'viewed'، بس **مفيش أي timestamp** للحظة دي
-- في المنظومة كلها. اتأكدنا من ده قبل إضافة العمود:
--   * مسارين بيكتبوا 'viewed' (`OrdersService.markViewedByTechnician` و
--     `MatchingService` وقت سحب قايمة العروض) — ولا واحد فيهم بيسجّل وقت.
--   * `orders.technician_viewed_at` حاجة تانية خالص: بتتسجّل للفني **المعيَّن** بعد ما ياخد
--     الطلب، مش لكل عرض اتبعت.
--   * `responded_at` بيتسجّل عند القبول/الرفض بس، فلحظة المشاهدة بتضيع لما الحالة تتحرّك بعدها.
--
-- من غير العمود ده الأدمن بيشوف «VIEWED» بلا وقت، ومايقدرش يجاوب على «الفني شاف العرض بعد كام
-- ثانية وردّ بعد كام» — وده أساس تشخيص أي بطء في التوزيع.
--
-- Nullable عمدًا: العروض القديمة مالهاش وقت مشاهدة، و`NULL` معناها «مش معروف» مش صفر — نفس
-- قاعدة المشروع في ADR-0061.
ALTER TABLE order_assignments ADD COLUMN IF NOT EXISTS viewed_at timestamptz;

COMMENT ON COLUMN order_assignments.viewed_at IS
  'لحظة أول مشاهدة للعرض من الفني. NULL = ماتشافش (أو عرض قديم قبل العمود). بتتكتب مرة واحدة بس — أول مشاهدة، مش آخر واحدة.';
