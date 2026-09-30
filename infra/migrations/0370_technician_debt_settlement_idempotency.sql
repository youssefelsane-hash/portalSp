-- docs/08 §188 — سداد مديونية الفني بقى idempotent زي التصحيح اليدوي للمحفظة بالظبط
-- (wallet_adjustments: UNIQUE (actor_user_id, idempotency_key)، migration 0116).
--
-- قبلها مكانش فيه أي حاجة تمنع إن نفس السداد يتسجّل مرتين: الشبكة قطعت والموظف داس تاني
-- = سداد مزدوج بفلوس حقيقية. والمفتاح مربوط بالموظف اللي سجّل، عشان مفتاحين متشابهين من
-- موظفين مختلفين مايتصادموش.
--
-- NULL مسموح للصفوف القديمة بس (اتسجّلت قبل المفتاح). المسار الحالي بيرفض أي طلب من غيره
-- (AdminTechnicianDebtController)، والفهرس الجزئي بيسيب الصفوف القديمة في حالها.

-- migration-safety: ok الجدول technician_debt_settlements فيه أقل من 10000 صف — كل صف تسجيل يدوي
-- من موظف مالية لسداد فني (مش حدث تلقائي)، فبناء الفهرس بيخلص في أجزاء من الثانية.
ALTER TABLE technician_debt_settlements
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(120) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_debt_settlements_actor_key
  ON technician_debt_settlements (recorded_by_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
