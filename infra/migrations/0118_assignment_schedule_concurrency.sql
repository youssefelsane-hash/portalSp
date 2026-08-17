-- baytak - 0118: Phase 7 assignment and schedule concurrency invariants.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The application already defines these as the statuses in which a technician consumes the
-- single active-work resource. Make the invariant true for every writer, not only matching.
CREATE UNIQUE INDEX uq_orders_one_active_per_technician
  ON orders(technician_id)
  WHERE technician_id IS NOT NULL
    AND deleted_at IS NULL
    AND order_status IN ('accepted', 'technician_on_way', 'technician_arrived', 'in_progress');

-- Half-open ranges permit adjacent slots (10:00-11:00 and 11:00-12:00) but reject overlap.
ALTER TABLE technician_schedule_slots
  ADD CONSTRAINT ex_technician_schedule_slots_no_overlap
  EXCLUDE USING gist (
    technician_id WITH =,
    tsrange(slot_date + start_time, slot_date + end_time, '[)') WITH &&
  )
  WHERE (deleted_at IS NULL);
