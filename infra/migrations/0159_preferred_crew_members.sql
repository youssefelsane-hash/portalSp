-- الفريق المفضّل (docs/08 §36.16، ADR-0022) — شبكة تفضيل نظير-لنظير دائمة، منفصلة تمامًا عن
-- order_team_members (طاقم مؤقت لطلب واحد) و technician_companies (توظيف رسمي) و
-- assistant_technician_id/assistant_link_status (علاقة غير متماثلة واحد-لواحد تحتاج موافقة أدمن).
-- اتجاه واحد بس (owner_technician_id → member_technician_id)، صفر موافقة أدمن — تفصيل الأسباب في
-- ADR-0022 نفسه.

CREATE TYPE preferred_crew_member_status AS ENUM ('invited', 'accepted', 'declined', 'removed');

CREATE TABLE technician_preferred_crew_members (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_technician_id   UUID NOT NULL REFERENCES technician_profiles(id),
  member_technician_id  UUID NOT NULL REFERENCES technician_profiles(id),
  status                preferred_crew_member_status NOT NULL DEFAULT 'invited',
  invited_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at          TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ NULL,
  CONSTRAINT chk_preferred_crew_not_self CHECK (owner_technician_id != member_technician_id)
);

-- علاقة واحدة "حية" (معلّقة أو مقبولة) بس بين نفس الاتنين في أي وقت — لو اتشالت (removed) أو
-- اترفضت (declined)، ممكن يتبعت دعوة جديدة تاني (صف جديد، مش تعارض مع القديم).
CREATE UNIQUE INDEX idx_preferred_crew_active_pair ON technician_preferred_crew_members
  (owner_technician_id, member_technician_id) WHERE status IN ('invited', 'accepted');

CREATE INDEX idx_preferred_crew_owner ON technician_preferred_crew_members (owner_technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_preferred_crew_member ON technician_preferred_crew_members (member_technician_id) WHERE deleted_at IS NULL;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_preferred_crew_members
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.preferred_crew_max_size', '10', 'number', 'matching', 'أقصى عدد أعضاء مقبولين في الفريق المفضّل الدائم لكل فني (docs/08 §36.16)', false)
ON CONFLICT (key) DO NOTHING;
