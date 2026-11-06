-- PayKit server storage. Each table keeps the full record as JSONB (`data`) plus a few
-- columns that are indexed for lookups. Created automatically on startup (idempotent).

CREATE TABLE IF NOT EXISTS merchants (
  id          text PRIMARY KEY,           -- onchain merchantId (bytes32 hex)
  merchant_id text,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchants_api_key ON merchants ((data->>'apiKeyHash'));

CREATE TABLE IF NOT EXISTS invoices (
  id          text PRIMARY KEY,           -- inv_<uuid>
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_merchant ON invoices (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quotes (
  id          text PRIMARY KEY,           -- qt_<uuid>
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quotes_payment_key ON quotes ((data->>'paymentKey'));

CREATE TABLE IF NOT EXISTS payments (
  id          text PRIMARY KEY,           -- onchain payment key
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_merchant ON payments (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS refunds (
  id          text PRIMARY KEY,           -- rf_<uuid>
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_onchain ON refunds ((data->>'refundId'));

CREATE TABLE IF NOT EXISTS plans (
  id          text PRIMARY KEY,           -- plan_<uuid>: a subscription / installment offer
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_merchant ON plans (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id          text PRIMARY KEY,           -- sub_<uuid>: one customer's onchain plan
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_plan_key ON subscriptions ((data->>'planKey'));
CREATE INDEX IF NOT EXISTS subscriptions_status ON subscriptions ((data->>'status'));

-- universal loyalty points (PaymentRouterV2 + PayKitPoints)
CREATE TABLE IF NOT EXISTS point_campaigns (
  id          text PRIMARY KEY,           -- camp_<uuid>: issuer side, "earn N points per USDT"
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_campaigns_hash ON point_campaigns ((data->>'idHash'));

CREATE TABLE IF NOT EXISTS rewards (
  id          text PRIMARY KEY,           -- rw_<uuid>: redeemer side, "P points for X off"
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rewards_hash ON rewards ((data->>'idHash'));

CREATE TABLE IF NOT EXISTS points_ledger (
  id          text PRIMARY KEY,           -- <txHash>:<logIndex>, one row per onchain points event
  merchant_id text,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS points_ledger_wallet ON points_ledger ((data->>'wallet'));
CREATE INDEX IF NOT EXISTS points_ledger_merchant ON points_ledger (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS points_wallets (
  id          text PRIMARY KEY,           -- wallet address: cached balance mirrored from PayKitPoints
  merchant_id text,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          text PRIMARY KEY,           -- evt_<uuid>
  merchant_id text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_pending ON webhook_events ((data->>'status'));

CREATE TABLE IF NOT EXISTS txs (
  id          text PRIMARY KEY,           -- tx hash
  merchant_id text,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refill_runs (
  id          text PRIMARY KEY,
  merchant_id text,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kv (
  id          text PRIMARY KEY,           -- e.g. 'observer.cursor'
  merchant_id text,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
