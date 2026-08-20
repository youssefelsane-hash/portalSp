-- baytak — 0155: تمييز فرص الشغل الاختيارية بين "تعيين قائد" (السلوك القديم) و"تجنيد عضو فريق"
-- (docs/08 §35، ADR-0021 §2). راجع docs/adr/0021-crew-composition-and-admin-operations-layer.md.
--
-- السبب: technician_work_opportunities الموجودة (migration 0153) بُنيت أصلاً لسيناريو واحد بس —
-- فني MEANINGFUL/HEAVY بيتعرضله فرصة "تبقى القائد/المسؤول عن الطلب ده" (قبولها = confirmTechnicianForOrder،
-- محتاج order_status='searching_technician'، مفيش قائد لسه). تجنيد فريق (§31/§35) محتاج سيناريو
-- تاني تمامًا: الطلب أصلاً له قائد، والعرض هنا "تنضم كعضو فريق تحته" — قبولها لازم يضيف صف
-- order_team_members، مش يغيّر orders.technician_id. بدل جدول/كيان مواز بالكامل (انجراف مستقبلي
-- محتّم)، نفس الجدول بيتوسّع بعمود تمييز — كل الـCRUD الأساسي (offerIfNotExists/markDecided/
-- getOwnedOfferedOrThrow) يفضل مشترك زي ما هو، بس منطق القبول يتفرّع حسب context.

ALTER TABLE technician_work_opportunities
  ADD COLUMN context VARCHAR(20) NOT NULL DEFAULT 'assignment',
  ADD COLUMN crew_role VARCHAR(20) NULL;

ALTER TABLE technician_work_opportunities
  ADD CONSTRAINT chk_technician_work_opportunities_context
    CHECK (context IN ('assignment', 'crew_recruit')),
  ADD CONSTRAINT chk_technician_work_opportunities_crew_role
    CHECK (
      (context = 'assignment' AND crew_role IS NULL)
      OR (context = 'crew_recruit' AND crew_role IN ('technician', 'assistant'))
    );

COMMENT ON COLUMN technician_work_opportunities.context IS
  'assignment = فرصة "تبقى قائد الطلب" (السلوك الأصلي، migration 0153) — crew_recruit = فرصة "تنضم كعضو فريق تحت قائد موجود بالفعل" (docs/08 §35)';
COMMENT ON COLUMN technician_work_opportunities.crew_role IS
  'للـcrew_recruit بس: الدور المطلوب فعلاً (technician/assistant) — يحدد أي عدّاد نقص (missingTechnicians/missingAssistants) العرض ده بيسدّه لو اتقبل';
