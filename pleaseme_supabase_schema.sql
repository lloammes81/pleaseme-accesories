-- ================================================================
--  PLEASEME — Supabase Schema v2
--  Proyecto: https://bgyfrhcrqnoayqrntzom.supabase.co
--
--  INSTRUCCIONES:
--  1. Ve a Supabase → SQL Editor → New Query
--  2. Pega TODO y clic en RUN ▶
-- ================================================================

DROP TABLE IF EXISTS productos  CASCADE;
DROP TABLE IF EXISTS pedidos    CASCADE;
DROP TABLE IF EXISTS clientes   CASCADE;
DROP TABLE IF EXISTS config     CASCADE;

-- 1. PRODUCTOS
CREATE TABLE productos (
  id         TEXT PRIMARY KEY,
  record     JSONB NOT NULL DEFAULT '{}',
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PEDIDOS
CREATE TABLE pedidos (
  id         TEXT PRIMARY KEY,
  record     JSONB NOT NULL DEFAULT '{}',
  status     TEXT DEFAULT 'pendiente',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CLIENTES
CREATE TABLE clientes (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE,
  record     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CONFIG
CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value JSONB
);

-- 5. CONFIG INICIAL
INSERT INTO config (key, value) VALUES
  ('company',    '{"name":"Pleaseme","whatsapp":"10000000000","email":"hello@pleaseme.com","instagram":"@pleasemejewels","address":"","logoUrl":""}'),
  ('storefront', '{"freeShip":100,"currency":"USD","ppEmail":"payments@pleaseme.com"}'),
  ('admin',      '{"passwordHash":"admin123"}')
ON CONFLICT (key) DO NOTHING;

-- 6. INDICES
CREATE INDEX idx_productos_active  ON productos(active);
CREATE INDEX idx_productos_created ON productos(created_at DESC);
CREATE INDEX idx_pedidos_status    ON pedidos(status);
CREATE INDEX idx_pedidos_created   ON pedidos(created_at DESC);
CREATE INDEX idx_clientes_email    ON clientes(email);

-- 7. RLS — acceso completo a llave anon (puedes restringir luego)
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE config    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON productos FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON pedidos   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON clientes  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON config    FOR ALL TO anon USING (true) WITH CHECK (true);

-- LISTO ✓
-- El primer acceso al panel Admin carga datos demo automaticamente.
