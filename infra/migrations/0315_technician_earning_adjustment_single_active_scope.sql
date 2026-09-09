-- A person can have one current global adjustment and one current adjustment per
-- service. Retire legacy duplicates deterministically before enforcing it.
WITH ranked_active_adjustments AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY technician_id, COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
           ORDER BY effective_from DESC, created_at DESC, id DESC
         ) AS position
    FROM technician_earning_adjustments
   WHERE disabled_at IS NULL
)
UPDATE technician_earning_adjustments adjustment
   SET disabled_at = now(), updated_at = now()
  FROM ranked_active_adjustments ranked
 WHERE adjustment.id = ranked.id
   AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_earning_adjustments_active_scope
  ON technician_earning_adjustments (
    technician_id,
    COALESCE(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE disabled_at IS NULL;
