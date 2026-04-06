create extension if not exists pgcrypto;

create table if not exists admin_users (
  telegram_user_id bigint primary key,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key,
  title text not null,
  short_description text not null,
  type text not null check (type in ('file', 'text', 'download_link', 'license_key')),
  pricing_mode text not null check (pricing_mode in ('fixed_xmr', 'usd_anchored')),
  fixed_price_atomic bigint,
  usd_price_cents integer,
  active boolean not null default true,
  encrypted_payload text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key,
  product_id uuid not null references products(id),
  state text not null check (
    state in (
      'created',
      'awaiting_payment',
      'payment_seen',
      'confirmed',
      'fulfilled',
      'underpaid',
      'expired',
      'purged'
    )
  ),
  pre_purge_state text check (
    pre_purge_state in (
      'created',
      'awaiting_payment',
      'payment_seen',
      'confirmed',
      'fulfilled',
      'underpaid',
      'expired',
      'purged'
    )
  ),
  pricing_mode text not null check (pricing_mode in ('fixed_xmr', 'usd_anchored')),
  quoted_amount_atomic bigint not null,
  quoted_amount_xmr text not null,
  usd_reference_cents integer,
  payment_address text not null,
  account_index integer not null,
  subaddress_index integer not null,
  quote_expires_at timestamptz not null,
  payment_tx_hash text,
  payment_received_atomic bigint,
  payment_seen_at timestamptz,
  confirmed_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists orders_account_subaddress_idx
  on orders (account_index, subaddress_index);

create index if not exists orders_state_created_idx
  on orders (state, created_at desc);

create table if not exists product_snapshots (
  id uuid primary key,
  order_id uuid not null unique references orders(id) on delete cascade,
  product_id uuid not null,
  title text not null,
  short_description text not null,
  type text not null check (type in ('file', 'text', 'download_link', 'license_key')),
  pricing_mode text not null check (pricing_mode in ('fixed_xmr', 'usd_anchored')),
  quoted_amount_atomic bigint not null,
  quoted_amount_xmr text not null,
  usd_reference_cents integer,
  encrypted_payload_snapshot text,
  payload_reference text,
  created_at timestamptz not null default now()
);

create table if not exists payment_events (
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  tx_hash text not null,
  amount_atomic bigint not null,
  confirmations integer not null default 0,
  category text not null check (category in ('qualifying', 'underpaid')),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  confirmed_at timestamptz,
  unique (order_id, tx_hash)
);

create index if not exists payment_events_last_seen_idx
  on payment_events (last_seen_at desc);

create table if not exists fulfillment_records (
  id uuid primary key,
  order_id uuid not null unique references orders(id) on delete cascade,
  delivery_type text not null check (delivery_type in ('file', 'text', 'download_link', 'license_key')),
  status text not null check (status in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0,
  last_error_code text,
  delivered_at timestamptz,
  last_attempt_at timestamptz,
  receipt_message_id integer
);

create table if not exists license_stock_items (
  id uuid primary key,
  product_id uuid not null references products(id) on delete cascade,
  encrypted_secret text not null,
  state text not null check (state in ('available', 'reserved', 'consumed')),
  reserved_order_id uuid unique,
  consumed_order_id uuid unique,
  reserved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists bot_settings (
  key text primary key,
  value_json jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists retention_links (
  order_id uuid primary key references orders(id) on delete cascade,
  telegram_user_id bigint,
  expires_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists retention_links_expiry_idx
  on retention_links (expires_at)
  where purged_at is null;
