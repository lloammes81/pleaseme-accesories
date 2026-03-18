-- ════════════════════════════════════════════════════════════════
--  PLEASEME — Tablas independientes para Facturación
--  Supabase SQL Editor → New Query → RUN ▶
--
--  Tablas nuevas:  facturas, factura_items
--  Tabla compartida: clientes (ya existe, NO se toca)
-- ════════════════════════════════════════════════════════════════

-- ── 1. TABLA FACTURAS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturas (
  id               TEXT PRIMARY KEY,
  invoice_num      TEXT UNIQUE,
  invoice_status   TEXT DEFAULT 'pendiente'
    CHECK (invoice_status IN (
      'pendiente','procesando','pagada','cancelada','cancelado','anulado'
    )),
  -- Cliente (enlace opcional a tabla clientes)
  client_id        TEXT,
  client_name      TEXT,
  client_email     TEXT,
  client_phone     TEXT,
  shipping_address TEXT,
  -- Totales
  subtotal         NUMERIC DEFAULT 0,
  discount_type    TEXT    DEFAULT 'pct',
  discount_value   NUMERIC DEFAULT 0,
  discount_amount  NUMERIC DEFAULT 0,
  shipping_cost    NUMERIC DEFAULT 0,
  total            NUMERIC DEFAULT 0,
  -- Pago
  currency         TEXT    DEFAULT 'USD',
  payment_method   TEXT,
  payment_type     TEXT    DEFAULT 'contado',
  credit_days      INTEGER DEFAULT 0,
  due_date         DATE,
  deposit          NUMERIC DEFAULT 0,
  balance_due      NUMERIC DEFAULT 0,
  -- Anulación
  void_reason      TEXT,
  void_note        TEXT,
  void_at          TIMESTAMPTZ,
  -- Otros
  notes            TEXT,
  items_count      INTEGER DEFAULT 0,
  record           JSONB   DEFAULT '{}',   -- objeto completo para compatibilidad
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. TABLA FACTURA_ITEMS (líneas de detalle) ───────────────────
CREATE TABLE IF NOT EXISTS factura_items (
  id           TEXT PRIMARY KEY,
  factura_id   TEXT NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  product_id   TEXT,
  product_name TEXT,
  sku          TEXT,
  qty          INTEGER DEFAULT 1,
  unit_price   NUMERIC DEFAULT 0,
  total        NUMERIC DEFAULT 0,
  record       JSONB   DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. ÍNDICES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_facturas_status  ON facturas(invoice_status);
CREATE INDEX IF NOT EXISTS idx_facturas_client  ON facturas(client_id);
CREATE INDEX IF NOT EXISTS idx_facturas_created ON facturas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_num     ON facturas(invoice_num);
CREATE INDEX IF NOT EXISTS idx_fitems_factura   ON factura_items(factura_id);

-- ── 4. RLS ───────────────────────────────────────────────────────
ALTER TABLE facturas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE factura_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='facturas'      AND policyname='anon_all') THEN
    CREATE POLICY "anon_all" ON facturas      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='factura_items' AND policyname='anon_all') THEN
    CREATE POLICY "anon_all" ON factura_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
--  LISTO ✓
--  - facturas      → facturas del sistema de facturación manual
--  - factura_items → líneas de detalle de cada factura
--  - clientes      → compartida con pedidos (sin cambios)
-- ════════════════════════════════════════════════════════════════
