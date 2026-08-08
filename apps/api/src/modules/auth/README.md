# modules/auth

التسجيل، OTP، JWT + refresh token rotation، RBAC. جداول: users, otp_codes, refresh_tokens, roles, permissions, role_permissions, user_roles (قاموس §2).

- **`DELETE /auth/me` (`deleteMe`)**: حذف الحساب الذاتي — إلغاء كل التوكنات، `is_active=false`، بعدين `softDelete` على `users`. نفس التسلسل ده اتّبعته `AdminEmployeesService.delete()` (`../admin/admin-employees.service.ts`) لحذف حساب موظف، وده اللي كشف بَقّة حقيقية موثّقة تحت.
- **بَقّة حقيقية اتلقطت واتصلحت (`infra/migrations/0035`)**: `users_phone_number_key`/`users_email_key`/`users_referral_code_key` كانوا `UNIQUE` عادي على العمود كله (من `0003_auth.sql`) — بيشمل الصفوف المحذوفة (`deleted_at IS NOT NULL`)، عكس `idx_users_phone_number`/`idx_users_referral_code` (من نفس الملف) اللي كانوا partial بالفعل (`WHERE deleted_at IS NULL`). النتيجة: أي حساب اتعمله `softDelete` (سواء عبر `deleteMe` الذاتي أو حذف موظف من الإدارة) كان بيقفل رقمه/إيميله للأبد — أي تسجيل جديد بنفس القيمة بيرمي `duplicate key violation` خام (500) بدل رفض نضيف. اتصلحت باستبدال الثلاث قيود بـ partial unique index واحد لكل عمود. اتأكد الإصلاح حياً عبر `../admin/README.md` (قسم إدارة الموظفين).

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
