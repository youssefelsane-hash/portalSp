-- baytak (صُنّاع) — 0065: نظام العمائر (docs/08 §13، ADR-0003)
-- كيان مستقل، خصم منفصل عن promo_codes ومتبادل استبعادياً معاه (mutually exclusive) في v1 —
-- القرار الكامل وأسبابه في docs/adr/0003-buildings-qr-discount.md.
CREATE TABLE buildings (
  id                       UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  code                     VARCHAR(20)    NOT NULL UNIQUE,
  name_ar                  VARCHAR(200)   NOT NULL,
  -- عنوان وصفي بسيط، مش FK لـ addresses — العمارة مالهاش عميل واحد يملكها، سكانها متعددين.
  address_text             TEXT           NULL,
  city_id                  UUID           NULL REFERENCES cities(id),
  discount_percentage      NUMERIC(5,2)   NOT NULL DEFAULT 10,
  -- "اشتراك شهري بحد أدنى طلبات" — تتبّع بس، مفيش إنفاذ تلقائي (القرار موثّق في ADR-0003).
  minimum_monthly_orders   SMALLINT       NOT NULL DEFAULT 5,
  is_active                BOOLEAN        NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
  deleted_at               TIMESTAMPTZ    NULL
);
CREATE INDEX idx_buildings_code ON buildings(code);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON buildings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE orders ADD COLUMN building_id UUID NULL REFERENCES buildings(id);
CREATE INDEX idx_orders_building_id ON orders(building_id) WHERE building_id IS NOT NULL;

INSERT INTO permissions (name, resource, action) VALUES
  ('buildings.manage', 'buildings', 'manage');

-- لازم تُمنح لـ super_admin/ops_manager صراحة — درس اتعلّمناه في 0037/0038 (الـ CROSS JOIN
-- في 0020 كان snapshot لحظي وقتها بس، مش قاعدة حية).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'buildings.manage'
WHERE r.name IN ('super_admin', 'ops_manager');
