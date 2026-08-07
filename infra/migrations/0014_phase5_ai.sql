-- baytak — 0014: المرحلة 5 — الذكاء الاصطناعي (تصميم مبدئي، مؤجّل حسب توصية الماستر بلان §14)
-- مرجع: docs/02-data-dictionary.md §12 (المرحلة 5)

CREATE TABLE ai_diagnoses (
  id                          UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                    UUID                NULL REFERENCES orders(id),
  customer_id                 UUID                NOT NULL REFERENCES customer_profiles(id),
  input_image_urls            TEXT[]              NOT NULL DEFAULT '{}',
  input_description           TEXT                NULL,
  predicted_category_id       UUID                NULL REFERENCES service_categories(id),
  predicted_service_id        UUID                NULL REFERENCES services(id),
  confidence_score            NUMERIC(5,4)        NULL,
  estimated_min_price_cents   INTEGER             NULL,
  estimated_max_price_cents   INTEGER             NULL,
  diagnosis_text_ar           TEXT                NULL,
  urgency_level               ai_urgency_level    NULL,
  model_version                VARCHAR(40)        NOT NULL,
  was_accepted_by_customer    BOOLEAN             NULL,
  actual_service_id           UUID                NULL REFERENCES services(id),
  actual_price_cents          INTEGER             NULL,
  was_prediction_correct      BOOLEAN             NULL,
  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_diagnoses_customer_id ON ai_diagnoses(customer_id);
CREATE INDEX idx_ai_diagnoses_order_id ON ai_diagnoses(order_id);
