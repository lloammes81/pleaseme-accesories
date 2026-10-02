# Pleaseme — Supabase + base de datos local

El sistema se conecta **automáticamente a Supabase** cuando hay internet. No
hay que pulsar nada.

- **Con internet**: todo se lee de Supabase y se guarda en Supabase. También se
  guarda una copia en este equipo (IndexedDB, dentro del navegador).
- **Sin internet**: se sigue trabajando con la copia de este equipo. Los
  cambios quedan en espera y se suben solos a Supabase cuando vuelve internet.
- Abajo a la izquierda (en Facturación y Admin) se ve el estado:
  **☁ Supabase conectado** o **⚠ Sin conexión a Supabase · N cambios por
  subir**. Pulsa el indicador para reintentar o ver el detalle del error.
- La primera vez que un equipo se conecta, sube a Supabase las facturas,
  clientes, etc. que solo estaban en ese equipo. Solo agrega lo que falta:
  nunca cambia ni borra nada en Supabase.
- Si Supabase no tiene alguna columna (por ejemplo, el casillero), ese dato se
  guarda solo en el equipo y el resto sí se sube.
- Si siempre sale "Sin conexión" aunque haya internet, el proyecto de Supabase
  puede estar **pausado**. Entra a supabase.com, abre el proyecto y pulsa
  **Restore project**.

## Pasar la información que ya tienes

1. Abre el sistema como siempre: Facturación (`index.html`) o Admin
   (`admin.html`).
2. Pulsa **🗄 BD local**. En Facturación está arriba, junto a "Información
   Compañía"; en Admin está junto al indicador de base de datos.
3. Pulsa **⇪ Traer mis datos (Supabase + navegador)**. Necesita internet esta
   única vez. Copia a la base local:
   - todo lo que estaba en Supabase: facturas, clientes, productos, pedidos,
     configuración, usuarios y transportistas;
   - lo guardado en ese navegador, incluidas las facturas que nunca llegaron a
     Supabase.
4. Al terminar, cierra la ventana y la página se recarga con tus datos.

Esta operación no borra nada. Solo quita los datos de demostración que el admin
crea cuando la base está vacía. Puedes repetirla sin riesgo.

## Respaldos (muy importante)

Si se borran los datos del navegador o se daña el equipo, se pierde la base de
datos. Por eso:

- Pulsa **🗄 BD local → 💾 Descargar respaldo** con frecuencia y guarda el
  archivo `.json` en un USB o en la nube.
- Para recuperar los datos, o para pasarlos a otro equipo, usa
  **📂 Restaurar** y elige ese archivo.

- **No uses** "Borrar datos de navegación / cookies y datos de sitios" en ese
  navegador.

## Registro de facturas en Excel

**⬇ Excel** (en Facturación) descarga el registro **completo** de facturas:

- Hoja **Facturas**: una fila por factura con todos sus datos (cliente,
  direcciones, casillero, artículos, subtotal, envío, descuento, total, método
  de pago, tracking, notas…). La última columna, "Datos completos (no editar)",
  guarda una copia exacta de la factura para poder restaurarla sin perder nada.
- Hoja **Artículos**: una fila por artículo de cada factura.

Sin internet se descarga un `.csv` con la hoja Facturas, que también se puede
restaurar completo.

## Restaurar facturas desde Excel o CSV

1. Pulsa **📂 Restaurar** (en Facturación junto a "⬇ Excel", en Admin junto a
   "📊 Exportar CSV", o dentro de **🗄 BD local**).
2. Elige el archivo `.xlsx`, `.xls` o `.csv`.
3. Se crean las facturas que falten. Las que ya existen no se cambian; solo
   se completan los datos vacíos (por ejemplo, los artículos).

Los archivos descargados **antes** de esta versión solo traen el resumen
(número, cliente, email, teléfono, total, estado y fecha), sin artículos. Para
recuperar esas facturas completas usa **🗄 BD local → ⇪ Traer mis datos**
(con internet): copia las facturas completas que estaban en Supabase y las
guardadas en el navegador, y reemplaza las copias resumidas sin duplicarlas.
Abrir un archivo `.xlsx` necesita internet; un `.csv` funciona sin internet.

## Facturas sin artículos

Antes, los artículos de cada factura se guardaban en estos lugares:

1. **Supabase** (en la nube): tabla `facturas`, columna `items`.
2. **Este navegador**: IndexedDB `pleaseme_facturacion` (tabla `facturas`) y
   localStorage `pm_orders_v1` (también `pm_orders` y `pm_orders_v2`).

Ahora se guardan en la base local `pleaseme_bd_local`.

Si una factura muestra el cliente y el total pero no sus artículos, pulsa
**🗄 BD local → 🔎 Recuperar artículos**. El sistema busca en todos esos
lugares (para Supabase necesita internet), te dice cuántos artículos encontró
en cada uno y completa solo las facturas que no tienen artículos. Las que ya
los tienen no cambian. Al abrir Facturación también se completan solas con lo
que haya en el navegador.

### Si "Recuperar artículos" no encuentra nada

El archivo anterior de Facturación guardaba los artículos en el navegador
(`localStorage "pm_orders_v1"`). Esa copia solo se ve desde **el mismo
navegador** y **la misma carpeta o dirección** desde donde se abría ese
archivo. Si el sistema nuevo se abre desde otro lugar, no la puede ver.

1. Copia `rescatar-facturas.html` en la misma carpeta donde estaba el archivo
   anterior y ábrelo en el mismo navegador de siempre. Si lo abrías desde una
   dirección web, ábrelo desde esa misma dirección.
2. La página dice cuántas facturas con artículos encontró. Pulsa
   **💾 Descargar respaldo de facturas**. Si no encuentra ninguna, prueba en
   otro navegador (Chrome, Edge…).
3. En Facturación pulsa **🗄 BD local → 📂 Restaurar** y elige ese archivo.
   Solo se completan los artículos que faltan y se agregan las facturas que no
   están.

### Restaurar desde el respaldo de Supabase

Si descargaste el respaldo de la base de datos desde el panel de Supabase
(archivo `db_cluster-….backup.gz`), pulsa **🗄 BD local → 📂 Restaurar** y
elige ese archivo tal cual, sin descomprimirlo. Se completan los artículos de
las facturas que no los tienen y se agregan las facturas que falten.
📂 Restaurar reconoce cada archivo por su contenido, así que funciona aunque el
navegador lo haya guardado con otro nombre o sin extensión.

## Ten en cuenta

- La **tienda online** y **Mi cuenta** también usan la base local. Solo ven los
  datos del navegador donde se abren; los clientes ya no pueden comprar desde
  internet.
- La información **no se comparte entre equipos**. Para copiarla de un equipo a
  otro, usa un respaldo.
