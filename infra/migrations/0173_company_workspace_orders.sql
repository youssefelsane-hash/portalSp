-- baytak — 0173: مساحة عمل الشركة (ADR-0033) — عمود snapshot يربط الطلب بالشركة اللي اتعيّن لها
-- فعليًا وقت التعيين، مش استعلام حي (تفاصيل كاملة في docs/adr/0033-company-workspace-orders.md).

ALTER TABLE orders ADD COLUMN assigned_company_id UUID REFERENCES technician_companies(id);
CREATE INDEX idx_orders_assigned_company_id ON orders (assigned_company_id) WHERE assigned_company_id IS NOT NULL;
