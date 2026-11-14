-- Anti overselling (lapis kedua selain logika aplikasi)
ALTER TABLE "ticket_categories"
  ADD CONSTRAINT chk_stock CHECK (sold >= 0 AND reserved >= 0 AND sold + reserved <= quota);

ALTER TABLE "orders"
  ADD CONSTRAINT chk_order_amount CHECK ("totalAmount" >= 0 AND "subtotal" >= 0);

ALTER TABLE "users"
  ADD CONSTRAINT chk_points CHECK ("pointBalance" >= 0);
