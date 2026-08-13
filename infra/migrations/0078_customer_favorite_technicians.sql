-- المفضّلة (Favorites) — docs/10 بند 36، كانت مؤجّلة عمدًا كـbacklog منفصل. أبسط شكل ممكن:
-- العميل يقدر يحفظ فني في قايمة مفضلة عشان يعيد حجزه بسهولة من غير ما يدوّر عليه تاني. حذف
-- الصف = إلغاء تفضيل صريح (نفس نمط order_team_members — جدول عضوية بسيط، مفيش deleted_at).

CREATE TABLE customer_favorite_technicians (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_user_id  UUID          NOT NULL REFERENCES users(id),
  technician_id     UUID          NOT NULL REFERENCES technician_profiles(id),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (customer_user_id, technician_id)
);

CREATE INDEX idx_customer_favorite_technicians_customer ON customer_favorite_technicians(customer_user_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON customer_favorite_technicians
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE customer_favorite_technicians IS 'قايمة الفنيين المفضّلين لكل عميل — إعادة حجز أسرع لفني اشتغل معاه قبل كده. توفّل صريح، مفيش ترشيح تلقائي.';
