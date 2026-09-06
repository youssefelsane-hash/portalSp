-- ADR-0079 — الشركة منفّذ من الدرجة الأولى: **نفس الجداول**، مش جداول موازية.
--
-- طلب المالك بالحرف (2026-09-06): «أنا عايز الشركة يكون عندها نفس اللي عند الفني بالضبط…
-- ما تعملهاش حاجات زي الفني، لأ، دخّلها على نفس اللاين… بحيث لما أنا أغيّر حاجة كلها ترفليكت
-- في بعض مرة واحدة».
--
-- الجداول التلاتة دي بقت جداول **نطاق منفّذ** (provider scope): الصف يخصّ فني فرد أو شركة،
-- واحد بالظبط. قاعدة الأهلية بتفضل جملة SQL واحدة بيتغيّر فيها عمود المالك بس.
--
-- **صفر أثر على السلوك القايم**: كل الصفوف الموجودة `technician_id` مليان و`company_id` NULL،
-- وكل استعلام قايم بيفلتر `technician_id = X` — فصفوف الشركة (`technician_id IS NULL`) مستحيل
-- تظهر في أي مسار قديم.

-- ── technician_services ──────────────────────────────────────────────
ALTER TABLE technician_services
  ADD COLUMN company_id uuid REFERENCES technician_companies(id) ON DELETE CASCADE;
ALTER TABLE technician_services ALTER COLUMN technician_id DROP NOT NULL;
ALTER TABLE technician_services
  ADD CONSTRAINT chk_technician_services_owner CHECK (
    (technician_id IS NOT NULL AND company_id IS NULL)
    OR (technician_id IS NULL AND company_id IS NOT NULL)
  );
-- الفهرس الفريد القديم كان على (technician_id, service_id) بلا شرط — مع عمود مالك تاني لازم
-- يبقى جزئي، وإلا كل صفوف الشركة (technician_id NULL) هتتعامل كقيم مميزة بلا أي حماية تكرار.
ALTER TABLE technician_services DROP CONSTRAINT technician_services_technician_id_service_id_key;
CREATE UNIQUE INDEX uq_technician_services_technician
  ON technician_services (technician_id, service_id) WHERE technician_id IS NOT NULL;
CREATE UNIQUE INDEX uq_technician_services_company
  ON technician_services (company_id, service_id) WHERE company_id IS NOT NULL;

-- ── technician_categories ────────────────────────────────────────────
ALTER TABLE technician_categories
  ADD COLUMN company_id uuid REFERENCES technician_companies(id) ON DELETE CASCADE;
ALTER TABLE technician_categories ALTER COLUMN technician_id DROP NOT NULL;
ALTER TABLE technician_categories
  ADD CONSTRAINT chk_technician_categories_owner CHECK (
    (technician_id IS NOT NULL AND company_id IS NULL)
    OR (technician_id IS NULL AND company_id IS NOT NULL)
  );
ALTER TABLE technician_categories DROP CONSTRAINT technician_categories_technician_id_category_id_key;
CREATE UNIQUE INDEX uq_technician_categories_technician
  ON technician_categories (technician_id, category_id) WHERE technician_id IS NOT NULL;
CREATE UNIQUE INDEX uq_technician_categories_company
  ON technician_categories (company_id, category_id) WHERE company_id IS NOT NULL;

-- ── technician_zones ─────────────────────────────────────────────────
ALTER TABLE technician_zones
  ADD COLUMN company_id uuid REFERENCES technician_companies(id) ON DELETE CASCADE;
ALTER TABLE technician_zones ALTER COLUMN technician_id DROP NOT NULL;
ALTER TABLE technician_zones
  ADD CONSTRAINT chk_technician_zones_owner CHECK (
    (technician_id IS NOT NULL AND company_id IS NULL)
    OR (technician_id IS NULL AND company_id IS NOT NULL)
  );
DROP INDEX technician_zones_technician_id_service_zone_id_key;
CREATE UNIQUE INDEX uq_technician_zones_technician
  ON technician_zones (technician_id, service_zone_id) WHERE technician_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_technician_zones_company
  ON technician_zones (company_id, service_zone_id) WHERE company_id IS NOT NULL AND deleted_at IS NULL;

-- فهارس البحث بالمالك — نفس شكل الفهارس القايمة على technician_id بالظبط.
CREATE INDEX idx_technician_services_company_id ON technician_services (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX idx_technician_categories_company_id ON technician_categories (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX idx_technician_zones_company_id ON technician_zones (company_id) WHERE company_id IS NOT NULL AND deleted_at IS NULL;
