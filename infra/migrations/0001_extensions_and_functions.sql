-- baytak — 0001: إضافات Postgres والدوال المشتركة
-- مرجع: docs/02-data-dictionary.md §1

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- UUID v7 (مرتب زمنياً) — Postgres 16 لسه معندوش uuidv7() built-in (اتضافت في PG18).
-- بتحط timestamp بالميلي ثانية جوه أول 48 بت وتخلي الباقي عشوائي، مع ضبط بتات النسخة/المتغيّر.
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE sql
VOLATILE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

-- تحديث updated_at أوتوماتيك — يتربط بـ trigger على كل جدول فيه updated_at
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- توليد أرقام مسلسلة قابلة للقراءة (ORD-2026-000123 / TXN-2026-000123 ...)
-- بيستخدم sequence لكل بادئة+سنة عشان الترقيم يفضل تسلسلي حتى لو الطلبات جت بالتوازي
CREATE TABLE IF NOT EXISTS human_readable_sequences (
  sequence_key   VARCHAR(20) PRIMARY KEY,   -- مثال: 'ORD-2026'
  last_value     BIGINT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_human_readable_number(p_prefix VARCHAR(10))
RETURNS VARCHAR(24)
LANGUAGE plpgsql
AS $$
DECLARE
  v_year VARCHAR(4) := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY');
  v_key  VARCHAR(20) := p_prefix || '-' || v_year;
  v_next BIGINT;
BEGIN
  INSERT INTO human_readable_sequences (sequence_key, last_value)
  VALUES (v_key, 1)
  ON CONFLICT (sequence_key)
  DO UPDATE SET last_value = human_readable_sequences.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN p_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
END;
$$;
