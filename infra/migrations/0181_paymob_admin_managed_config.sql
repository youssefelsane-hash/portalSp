-- Paymob operational configuration is editable by step-up protected super admins.
-- Secret values are encrypted by SettingsService before storage and never returned raw.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.paymob.base_url', '"https://accept.paymob.com"', 'string', 'payments_paymob', 'Paymob API base URL', false),
  ('payments.paymob.api_key', '""', 'string', 'payments_paymob', 'Paymob API key (secret, encrypted)', false),
  ('payments.paymob.secret_key', '""', 'string', 'payments_paymob', 'Paymob Intention API secret key (secret, encrypted)', false),
  ('payments.paymob.public_key', '""', 'string', 'payments_paymob', 'Paymob Unified Checkout public key', false),
  ('payments.paymob.integration_id_card', '""', 'string', 'payments_paymob', 'Paymob card integration ID', false),
  ('payments.paymob.integration_id_mobile_wallet', '""', 'string', 'payments_paymob', 'Optional Paymob mobile-wallet integration ID', false),
  ('payments.paymob.hmac_secret', '""', 'string', 'payments_paymob', 'Paymob webhook HMAC secret (secret, encrypted)', false)
ON CONFLICT (key) DO NOTHING;
