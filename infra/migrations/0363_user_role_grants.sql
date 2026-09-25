-- **أدوار الحساب: العميل والصنايعي بنفس الرقم، والموظفين لأ** (ADR-0110، قرار مالك 2026-09-25).
--
-- `users.user_type` كان بيقول «المستخدم ده نوع واحد بالضبط»، فالفني اللي بيفتح تطبيق العميل
-- بنفس رقمه كان بيدخل ويوصل `/addresses` و`/wallet` (مالهمش `@Roles`) وبعدين يتقفل على
-- `/orders` بـ403 — **نص شغّال**. الجدول ده بيفصل «نوع التوظيف» عن «الأدوار الممنوحة».
--
-- ### الحماية مش في الكود — في القيد
--
-- التريجر تحت بيمنع أي منحة لحساب `admin`/`partner`. القيد في القاعدة هو الطبقة الوحيدة اللي
-- **مستحيل** refactor يتخطاها، والطبقتين التانيتين (الخدمة + الدخول) فوقه للرسايل الواضحة.
--
-- ### ليه مش عمود مصفوفة على `users`
--
-- المنحة ليها بيانات خاصة بيها: مين منحها وإمتى (تدقيق)، وإمكانية سحبها (`deleted_at`) من غير
-- ما نخسر التاريخ. مصفوفة معناها كل ده يضيع، وسحب دور يبقى `UPDATE` بلا أثر.

CREATE TABLE IF NOT EXISTS user_role_grants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- **`varchar` مش `user_type` enum** عمدًا: النطاق هنا استهلاكي بس (`customer`/`technician`)،
  -- والـenum فيه `admin`/`partner` اللي الجدول ده وجوده بيمنعهم. القيد أدق من الـenum.
  role varchar(20) NOT NULL CHECK (role IN ('customer', 'technician')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  -- NULL = منحة تلقائية من النظام (أول دخول من تطبيق العميل). مش NULL = أدمن منحها بإيده.
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- سبب حر للتدقيق: 'self_service' / 'registration' / 'backfill' / 'admin'
  granted_reason varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- دور واحد بس لكل مستخدم في نفس الوقت. **جزئي على `deleted_at IS NULL`** عشان سحب الدور
-- وإعادة منحه بعدين يفضل ممكن من غير ما نمسح صف التدقيق القديم.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_role_grants_active
  ON user_role_grants (user_id, role) WHERE deleted_at IS NULL;

-- كل نداء متوثّق بيقرا منح المستخدم (فحص حي في `JwtStrategy.validate`) — الفهرس ده بيخدمه.
CREATE INDEX IF NOT EXISTS idx_user_role_grants_user
  ON user_role_grants (user_id) WHERE deleted_at IS NULL;

-- ── الطبقة اللي مايتخطاهاش كود ──────────────────────────────────────────────
--
-- CHECK مايقدرش يقرا جدول تاني، فالقيد بتريجر. `BEFORE INSERT OR UPDATE` عشان يمسك كمان محاولة
-- تحويل منحة موجودة لمستخدم بقى موظف.
CREATE OR REPLACE FUNCTION assert_role_grant_target_is_consumer() RETURNS trigger AS $$
DECLARE
  target_type text;
BEGIN
  SELECT user_type::text INTO target_type FROM users WHERE id = NEW.user_id;
  IF target_type IN ('admin', 'partner') THEN
    RAISE EXCEPTION 'حساب موظف (%) ماينفعش ياخد دور % — ADR-0110', target_type, NEW.role
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_role_grants_consumer_only ON user_role_grants;
CREATE TRIGGER trg_user_role_grants_consumer_only
  BEFORE INSERT OR UPDATE OF user_id, role ON user_role_grants
  FOR EACH ROW EXECUTE FUNCTION assert_role_grant_target_is_consumer();

-- الاتجاه التاني: ترقية مستخدم عنده منح لحساب موظف. من غير ده، `UPDATE users SET user_type
-- = 'admin'` كان بيسيب منح شغّالة على حساب موظف وبيفتح بالظبط الثغرة اللي الجدول ده وجوده يقفلها.
CREATE OR REPLACE FUNCTION assert_employee_has_no_role_grants() RETURNS trigger AS $$
BEGIN
  IF NEW.user_type::text IN ('admin', 'partner')
     AND EXISTS (SELECT 1 FROM user_role_grants g WHERE g.user_id = NEW.id AND g.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'المستخدم % عنده أدوار استهلاكية ممنوحة فماينفعش يتحوّل لـ% — اسحب الأدوار الأول (ADR-0110)',
      NEW.id, NEW.user_type USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_employee_has_no_grants ON users;
CREATE TRIGGER trg_users_employee_has_no_grants
  BEFORE UPDATE OF user_type ON users
  FOR EACH ROW EXECUTE FUNCTION assert_employee_has_no_role_grants();

-- ── نقل الحالة الحالية ─────────────────────────────────────────────────────
--
-- كل حساب استهلاكي موجود بياخد منحة بدوره الحالي. **بلا ده الدخول بيقع لكل المستخدمين**: الكود
-- الجديد بيتحقق من المنحة قبل ما يوقّع التوكن، والحسابات القديمة مالهاش منح.
INSERT INTO user_role_grants (user_id, role, granted_reason)
SELECT u.id, u.user_type::text, 'backfill'
  FROM users u
 WHERE u.user_type::text IN ('customer', 'technician')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE user_role_grants IS
  'الأدوار الاستهلاكية الممنوحة لكل حساب (ADR-0110). الموظفين ممنوعين بتريجر. users.user_type = نوع التوظيف، والدور النشط في الجلسة في التوكن.';
