-- baytak — 0350: فصل «الخانة اللي اتملت» عن «الطبقة المالية» (ADR-0101، docs/08 §156)
--
-- المشكلة: `order_team_members.member_type` كان بيجاوب على تلات أسئلة مختلفة اتراكموا عليه:
--
--   1. «اتجنّد إزاي؟»  — الغرض الأصلي وقت migration 0075 (يدوي مقابل مطابقة تلقائية).
--   2. «بياخد كام؟»    — ADR-0050 خلاه نقطة فرض نسبة المساعد. **لازم يفضل زي ما هو.**
--   3. «ملا أنهي خانة؟» — `computeCrewComposition()` بتعدّ `team_member` كـ«فني متاح».
--
-- ADR-0101 بيسمح للمساعد المؤهّل إنه يملا خانة **تنفيذ** في خدمة مابتشترطش قائد فني. ساعتها
-- `resolveEffectiveMemberType()` بتفرض عليه `member_type='assistant'` (صح ماليًا وبقرار المالك:
-- «لا يرفعه ماليًا إلى Technician») — فالسؤال الثالث بيدّي إجابة غلط: خانة التنفيذ تفضل ناقصة
-- للأبد، `crewComplete` مايبقاش true، وتصعيد نقص الطاقم يفضل شغّال على طلب طاقمه كامل فعلاً.
--
-- الحل: عمود مستقل للسؤال الثالث. `member_type` يفضل الطبقة المالية بلا أي لمسة —
-- `crew-earnings.service.ts` بيقرا `otm.member_type` وبس، فالفلوس مالهاش أي علاقة بالتغيير ده.
--
-- Expand-only: العمود له DEFAULT وبيتعمله backfill من القيمة القايمة، فالصفوف التاريخية بتفضل
-- بنفس معناها بالظبط ومفيش أي سلوك بيتغيّر للطلبات اللي قبل الترحيل.

ALTER TABLE order_team_members
  ADD COLUMN crew_slot VARCHAR(20) NOT NULL DEFAULT 'execution'
  CHECK (crew_slot IN ('execution', 'helper'));

COMMENT ON COLUMN order_team_members.crew_slot IS
  'الخانة اللي العضو بيملاها في الطلب: execution = خانة من required_technicians، helper = خانة من required_assistants. **منفصل عن member_type عمدًا** (ADR-0101): ده بيحكم اكتمال الطاقم، وmember_type بيحكم حصة الأرباح. مساعد ممكن يملا خانة execution في خدمة مابتشترطش قائد فني ويفضل ياخد نسبة المساعد.';

COMMENT ON COLUMN order_team_members.member_type IS
  'الطبقة المالية للعضو (ADR-0050): assistant = بياخد نسبة المساعد، team_member = حصة كاملة. بتتفرض من technician_profiles.technician_kind في resolveEffectiveMemberType() ومش بتتحدد لحظة الإضافة. **مش** الخانة اللي اتملت — دي crew_slot (ADR-0101).';

-- Backfill: نفس المعنى اللي كان مستنتج من `member_type` قبل الفصل، بالحرف.
-- (`computeCrewComposition` كانت بتعدّ `team_member` كخانة تنفيذ و`assistant` كخانة مساعدة.)
UPDATE order_team_members SET crew_slot = 'helper' WHERE member_type = 'assistant';

-- فحص اكتمال الطاقم بيفلتر بالخانة لكل طلب — نفس نمط فهرس `order_id` الموجود.
CREATE INDEX idx_order_team_members_order_slot ON order_team_members(order_id, crew_slot);
