-- baytak — 0179: Change Orders ربط بالمشروع والمرحلة + Auto-approve sweep
ALTER TABLE orders ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS milestone_id UUID NULL REFERENCES project_milestones(id);
CREATE INDEX IF NOT EXISTS idx_orders_milestone ON orders(milestone_id) WHERE milestone_id IS NOT NULL;
