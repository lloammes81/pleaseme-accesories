-- Pleaseme Facturación · tablas y columnas nuevas en Supabase
-- Ejecútalo una sola vez en Supabase → SQL Editor. Es seguro repetirlo.
-- (La base local del navegador crea todo esto sola; esto solo es para la copia en la nube.)

-- Clientes: dirección separada, país y notas
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS street  text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS city    text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS state   text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS zip     text;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS notes   text;

-- Facturas: partes de la dirección del cliente
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS client_street text;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS client_city   text;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS client_state  text;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS client_zip    text;

-- Abonos y pagos de las facturas
CREATE TABLE IF NOT EXISTS pagos (
  id         text PRIMARY KEY,
  factura_id text,
  monto      numeric,
  tipo       text,
  fecha      text,
  metodo     text,
  nota       text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pagos;
CREATE POLICY "anon_all" ON pagos FOR ALL TO anon USING (true) WITH CHECK (true);
