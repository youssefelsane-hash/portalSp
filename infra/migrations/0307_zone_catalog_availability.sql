-- Per-zone catalog controls. Missing rows deliberately mean "enabled" so existing zones keep
-- their current catalogue after deployment. Service overrides take precedence over category
-- overrides; the nearest category override wins for nested category trees.
CREATE TABLE service_zone_catalog_overrides (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_zone_id   UUID        NOT NULL REFERENCES service_zones(id) ON DELETE CASCADE,
  category_id       UUID        NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  service_id        UUID        NULL REFERENCES services(id) ON DELETE CASCADE,
  is_enabled        BOOLEAN     NOT NULL,
  created_by        UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_zone_catalog_override_target CHECK (
    (category_id IS NOT NULL AND service_id IS NULL)
    OR (category_id IS NULL AND service_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_zone_catalog_category_override
  ON service_zone_catalog_overrides(service_zone_id, category_id)
  WHERE category_id IS NOT NULL;

CREATE UNIQUE INDEX uq_zone_catalog_service_override
  ON service_zone_catalog_overrides(service_zone_id, service_id)
  WHERE service_id IS NOT NULL;

CREATE INDEX idx_zone_catalog_overrides_zone
  ON service_zone_catalog_overrides(service_zone_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_zone_catalog_overrides
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- One source of truth used by catalogue reads and the final booking guard. Keeping the precedence
-- in PostgreSQL prevents the mobile UI and the order path from drifting into different rules.
CREATE OR REPLACE FUNCTION catalog_service_enabled_in_zone(
  p_service_id UUID,
  p_service_zone_id UUID
) RETURNS BOOLEAN
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
  WITH RECURSIVE category_ancestry AS (
    SELECT category.id, category.parent_category_id, 0 AS depth, ARRAY[category.id] AS path
      FROM services service
      JOIN service_categories category ON category.id = service.category_id
     WHERE service.id = p_service_id
    UNION ALL
    SELECT parent.id, parent.parent_category_id, child.depth + 1, child.path || parent.id
      FROM service_categories parent
      JOIN category_ancestry child ON child.parent_category_id = parent.id
     WHERE NOT parent.id = ANY(child.path)
  ),
  service_override AS (
    SELECT override.is_enabled
      FROM service_zone_catalog_overrides override
     WHERE override.service_zone_id = p_service_zone_id
       AND override.service_id = p_service_id
     LIMIT 1
  ),
  category_override AS (
    SELECT override.is_enabled
      FROM category_ancestry ancestry
      JOIN service_zone_catalog_overrides override
        ON override.category_id = ancestry.id
       AND override.service_zone_id = p_service_zone_id
     ORDER BY ancestry.depth ASC
     LIMIT 1
  )
  SELECT COALESCE(
    (SELECT is_enabled FROM service_override),
    (SELECT is_enabled FROM category_override),
    TRUE
  );
$$;

CREATE OR REPLACE FUNCTION catalog_category_enabled_in_zone(
  p_category_id UUID,
  p_service_zone_id UUID
) RETURNS BOOLEAN
LANGUAGE SQL
STABLE
PARALLEL SAFE
AS $$
  WITH RECURSIVE category_ancestry AS (
    SELECT category.id, category.parent_category_id, 0 AS depth, ARRAY[category.id] AS path
      FROM service_categories category
     WHERE category.id = p_category_id
    UNION ALL
    SELECT parent.id, parent.parent_category_id, child.depth + 1, child.path || parent.id
      FROM service_categories parent
      JOIN category_ancestry child ON child.parent_category_id = parent.id
     WHERE NOT parent.id = ANY(child.path)
  )
  SELECT COALESCE(
    (
      SELECT override.is_enabled
        FROM category_ancestry ancestry
        JOIN service_zone_catalog_overrides override
          ON override.category_id = ancestry.id
         AND override.service_zone_id = p_service_zone_id
       ORDER BY ancestry.depth ASC
       LIMIT 1
    ),
    TRUE
  );
$$;
