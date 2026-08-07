-- baytak — 0019: حساب النظام (المنصة) — لازم يكون له users.id عشان wallets.owner_user_id NOT NULL UNIQUE
-- مرجع: docs/02-data-dictionary.md §7.1 — owner_type='platform' لسه محتاج صف مستخدم يشاور عليه.
-- UUID ثابت معروف (مش uuid_generate_v7) عشان الكود يقدر يرجّع له بثبات في أي بيئة.

INSERT INTO users (id, phone_number, full_name, user_type, is_active, phone_verified_at)
VALUES ('00000000-0000-7000-8000-000000000001', '+200000000000', 'baytak — حساب المنصة', 'admin', false, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO wallets (owner_user_id, owner_type, currency_code)
VALUES ('00000000-0000-7000-8000-000000000001', 'platform', 'EGP')
ON CONFLICT (owner_user_id) DO NOTHING;
