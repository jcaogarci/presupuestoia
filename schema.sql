-- ============================================================
-- PresupuestoIA — Supabase Schema v2
-- Incluye integración con Stripe
-- Ejecuta en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ── PROFILES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name               TEXT,
  trade                   TEXT,
  nif                     TEXT,
  phone                   TEXT,
  email                   TEXT,
  address                 TEXT,
  city                    TEXT,
  web                     TEXT,
  note                    TEXT,
  payment                 TEXT DEFAULT '50% al aceptar, 50% al finalizar',

  -- Plan y quota
  plan                    TEXT DEFAULT 'free' CHECK (plan IN ('free','pro','empresa')),
  quota_used              INTEGER DEFAULT 0,
  quota_reset_at          TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 month'),

  -- Stripe
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ── BUDGETS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  number          TEXT UNIQUE NOT NULL,
  date            TEXT,
  title           TEXT,
  items           JSONB DEFAULT '[]',
  subtotal        NUMERIC(10,2) DEFAULT 0,
  iva             NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) DEFAULT 0,
  notes           TEXT,
  validez         INTEGER DEFAULT 30,
  client_name     TEXT,
  client_email    TEXT,
  client_phone    TEXT,
  client_address  TEXT,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','sent','accepted','rejected')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets  ENABLE ROW LEVEL SECURITY;

-- Profiles: cada usuario solo ve y edita el suyo
DROP POLICY IF EXISTS "profiles_self" ON profiles;
CREATE POLICY "profiles_self"
  ON profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Budgets: cada usuario solo ve y edita los suyos
DROP POLICY IF EXISTS "budgets_owner" ON budgets;
CREATE POLICY "budgets_owner"
  ON budgets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS budgets_user_id_idx   ON budgets(user_id);
CREATE INDEX IF NOT EXISTS budgets_status_idx    ON budgets(status);
CREATE INDEX IF NOT EXISTS budgets_created_idx   ON budgets(created_at DESC);
CREATE INDEX IF NOT EXISTS profiles_stripe_idx   ON profiles(stripe_customer_id);

-- ── FUNCTION: auto-update updated_at ─────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── FUNCTION: reset quota mensual ────────────────────────────
-- Llama a esto desde un cron job mensual o desde el webhook de Stripe
CREATE OR REPLACE FUNCTION reset_free_quotas()
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET quota_used = 0,
      quota_reset_at = NOW() + INTERVAL '1 month'
  WHERE plan = 'free'
    AND quota_reset_at <= NOW();
END;
$$ LANGUAGE plpgsql;

-- ── VISTA: estadísticas por usuario ──────────────────────────
CREATE OR REPLACE VIEW budget_stats AS
SELECT
  user_id,
  COUNT(*)                                          AS total,
  COUNT(*) FILTER (WHERE status = 'accepted')       AS accepted,
  COUNT(*) FILTER (WHERE status = 'sent')           AS sent,
  COUNT(*) FILTER (WHERE status = 'pending')        AS pending,
  COALESCE(SUM(total), 0)                           AS total_amount,
  COALESCE(SUM(total) FILTER (WHERE status = 'accepted'), 0) AS accepted_amount,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'accepted')::numeric
    / NULLIF(COUNT(*),0) * 100, 1
  )                                                 AS acceptance_rate
FROM budgets
GROUP BY user_id;
