-- فهارس لتلات مفاتيح أجنبية على `users` كانت بلا فهرس داعم — `check-db-hygiene.js` في الـCI بيرفضها،
-- ولأن الخطوة دي قبل typecheck/lint/jest في شغلانة الـAPI، الـCI كان **بيتخطّى باقي الفحوص كلها**
-- من ساعة ما 0362/0363/0366 اتضافوا (2026-09-25) — يعني كان أحمر ومش بيختبر حاجة.
--
-- نفس سبب 0336 بالظبط: Postgres بيفهرس الطرف المُشار إليه بس، فأي حذف/تعديل مستخدم (حذف الحساب
-- `/auth/account`) بيعمل seq scan على الجداول دي عشان يتأكد إن مفيش صف بيشاور عليه.
--
-- جزئي (`IS NOT NULL`) للعمودين اللي بيقبلوا NULL؛ `issued_by_user_id` إجباري فالفهرس كامل.
--
-- migration-safety: ok التلات جداول صغار ومحدودين بطبيعتهم: pin_reset_tokens بيصدرها الدعم يدويًا،
-- user_role_grants صف لكل دور ممنوح، وclient_error_events بيتمسح تلقائيًا بعد
-- ops.client_errors_retention_days (30 يوم) — CREATE INDEX العادي بياخد أجزاء من الثانية عليهم.

CREATE INDEX IF NOT EXISTS idx_client_error_events_user_id
  ON client_error_events (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pin_reset_tokens_issued_by_user_id
  ON pin_reset_tokens (issued_by_user_id);

CREATE INDEX IF NOT EXISTS idx_user_role_grants_granted_by_user_id
  ON user_role_grants (granted_by_user_id)
  WHERE granted_by_user_id IS NOT NULL;
