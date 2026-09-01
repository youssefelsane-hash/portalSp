-- A customer may ask operations to price an inspection service from uploaded photos before
-- dispatch. Keep this distinct from the technician's on-site quote approval state.
ALTER TYPE order_status ADD VALUE 'awaiting_admin_quote';
