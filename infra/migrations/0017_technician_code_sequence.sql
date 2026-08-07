-- baytak — 0017: مولّد technician_code
-- مرجع: docs/02-data-dictionary.md §4.2 — الصيغة TECH-000123 (من غير سنة، عكس باقي الأرقام المسلسلة)

CREATE SEQUENCE technician_code_seq START 1;

CREATE OR REPLACE FUNCTION next_technician_code()
RETURNS VARCHAR(20)
LANGUAGE sql
AS $$
  SELECT 'TECH-' || lpad(nextval('technician_code_seq')::text, 6, '0');
$$;
