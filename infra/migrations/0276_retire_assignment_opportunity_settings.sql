-- ADR-0078: الطلبات الإضافية تستخدم جولات الطلبات؛ الإعدادان لم يعد لهما مستهلك.
DELETE FROM settings WHERE key IN (
  'matching.offer_heavy_workload_technicians',
  'matching.work_opportunity_exclusive_seconds'
);
