alter table license_stock_items
  add column if not exists secret_fingerprint text;

create unique index if not exists license_stock_items_product_fingerprint_idx
  on license_stock_items (product_id, secret_fingerprint)
  where secret_fingerprint is not null;
