ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS initial_quote_note varchar(1000);
