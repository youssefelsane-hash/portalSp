-- baytak - 0122: support atomic latest-code OTP consumption and resend invalidation.

CREATE INDEX idx_otp_codes_latest_unused
  ON otp_codes(phone_number, purpose, created_at DESC)
  WHERE is_used = false;
