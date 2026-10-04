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

## Respaldo diario automático

Una vez al día, a la hora de cierre (**18:00** por defecto), Facturación y
Admin **preguntan** abajo a la derecha: **«¿Hacer el respaldo de hoy?»**.
Con **Sí, hacer respaldo** se hace el respaldo completo; con **Más tarde** se
vuelve a preguntar en 2 horas. Mientras se hace aparece una notificación con
barra de progreso:

1. Lee toda la base de datos.
2. Guarda una copia en este equipo (se conservan las últimas 7).
3. Guarda el archivo en la **carpeta de respaldos** (ver abajo) o, si no hay
   carpeta elegida, lo descarga a Descargas. Si el navegador no lo descargó,
   pulsa **⬇ Descargar de nuevo** en la notificación.

Si la app estaba cerrada a esa hora, la pregunta aparece al abrirla. Una vez
hecho el respaldo del día no se vuelve a preguntar hasta el día siguiente.

### Carpeta de respaldos en Documentos (por fecha)

Para que los respaldos queden en una carpeta tuya, ordenados por fecha:

1. En la notificación del primer respaldo pulsa **📁 Elegir carpeta en
   Documentos** (o en **🗄 BD local → 📁 Carpeta de respaldos**).
2. En la ventana de Windows abre **Documentos**, crea una carpeta llamada
   **Pleaseme Respaldos** (botón "Nueva carpeta") y elígela. El navegador no
   deja elegir "Documentos" directamente, por eso hay que usar una subcarpeta.
3. Desde entonces cada día se guarda así:

```
Documentos\Pleaseme Respaldos\2026-10-02\pleaseme-respaldo-2026-10-02.json
Documentos\Pleaseme Respaldos\2026-10-03\pleaseme-respaldo-2026-10-03.json
```

- Los respaldos de la carpeta **no se borran solos**: bórralos tú cuando ya no
  los necesites.
- Si el navegador pide permiso otra vez (pasa a veces al reiniciarlo), el
  respaldo se descarga a Descargas y la notificación muestra **📁 Guardar en la
  carpeta**: púlsalo y concede el permiso. En Chrome/Edge puedes elegir
  "Permitir en cada visita" para que no vuelva a preguntar.
- Requiere Google Chrome o Microsoft Edge. En otros navegadores se descarga a
  Descargas.
- Para restaurar: **🗄 BD local → 📂 Restaurar** y elige el archivo `.json` de
  la fecha que quieras.

En **🗄 BD local** puedes cambiar la hora, desactivarlo o elegir no descargar
el archivo. **💾 Respaldar ahora** lo hace en el momento y **🕘 Copias
diarias** lista las copias guardadas y permite restaurar una.

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

## Abonos, saldo pendiente y cuentas por cobrar

En cada factura, el botón **💳 Abonos…** (debajo del total) permite registrar
pagos parciales o marcar la factura como "a crédito". Se muestra el abonado y el
saldo, y la factura lleva una etiqueta *Debe $X*. Una factura con saldo no se
marca "pagado" al imprimirla. El indicador **Por cobrar** y el filtro de la lista
suman todos los saldos. Los abonos se guardan en la tabla `pagos` (solo en la
base local, salvo que ejecutes `supabase-clientes-pagos.sql` en Supabase → SQL Editor,
que también agrega las columnas nuevas de clientes y de la dirección de las facturas).
Las facturas sin abonos se comportan igual que antes.

## Tasa de cambio USD/DOP

El botón **💱 Tasa** guarda la tasa del día (con historial y calculadora). Las
facturas muestran "Equivale a …" en la otra moneda usando la tasa vigente en la
fecha de la factura; al imprimir se guarda la tasa usada. La tasa de hoy se carga sola desde internet al abrir la app (y cada 3 horas);
una tasa que escribas a mano para hoy no se pisa, y el botón **🌐 Actualizar
desde internet** la fuerza. Al cambiar el país de
una factura se pregunta si se convierten los precios.

## Ficha de cliente

El botón **📇 Clientes** lista a los clientes (buscar y ordenar). Cada ficha
muestra facturas, total comprado, saldo pendiente, lo que más compra, WhatsApp,
"Recordar el saldo" y **＋ Nueva factura** con los datos ya llenos. El botón **＋ Nuevo cliente** de esa
ventana abre el registro (nombre, teléfono, país, correo, dirección, ciudad,
estado, código postal y notas); el código postal llena ciudad y estado, avisa si
el cliente o el teléfono ya existen y al guardar abre su ficha. También se
abre con el 📇 junto al nombre en el formulario. Las tarjetas cambian de tono
según lo comprado: 💎 VIP (top 10 %, dorado), ⭐ Frecuente (siguiente 15 %,
violeta) y 🙂 Habitual (hasta la mitad, turquesa).

## Dirección del cliente

Dirección, Ciudad, Estado y Código postal tienen su propio campo. Al escribir
el código postal (5 dígitos, USA o RD) se llenan ciudad y estado desde internet,
y al elegir una dirección del buscador se llenan los cuatro campos. En la
factura impresa sale la dirección completa en una línea.

### Clientes en USA y en RD, ciudad y courier

- La ventana **📇 Clientes** tiene dos pestañas: **Clientes en USA** y **Clientes en RD**
  (cada una con su cantidad). El país sale del registro del cliente; si no lo
  tiene, de su última factura (RD$ = RD), de un teléfono 809/829/849 o, si no, USA.
- El botón **📍 Ciudad** filtra la lista por la ciudad del cliente.
- En el registro de un cliente, si el país es **RD** la dirección es **una sola
  línea** y la ciudad se elige con el botón **📍 Seleccionar ciudad**; si es USA
  se usan dirección, código postal, ciudad (con 📍) y estado. Lo mismo ocurre en
  la factura: al elegir RD desaparece la fila de ciudad/estado/código postal.
- El botón **📦 Información del courier** (en el registro y en la ficha) guarda el
  nombre, la dirección en USA, el casillero, el teléfono y notas del courier. Al
  crear una factura desde la ficha, esos datos llenan "Dirección de envío (USA)" y
  el casillero.

## Aviso si pasan días sin respaldo

Si pasan 2 días (configurable en **🗄 BD local → Avisar tras N días**; 0 lo
apaga) sin guardar un archivo de respaldo, aparece un aviso con **Respaldar
ahora** o **Más tarde** (6 horas).

## Menú lateral

Todas las acciones están en un menú a la izquierda, con la marca arriba,
grupos (Facturación, Datos, Ajustes), iconos de línea y la tasa del día junto a
"Tasa dólar". La flecha de arriba lo pliega a solo iconos (con rótulo al pasar
el mouse; se recuerda al recargar). En pantallas pequeñas es un cajón que se
abre con **☰** y se cierra con Esc o tocando fuera.

## Ten en cuenta

- La **tienda online** y **Mi cuenta** también usan la base local. Solo ven los
  datos del navegador donde se abren; los clientes ya no pueden comprar desde
  internet.
- La información **no se comparte entre equipos**. Para copiarla de un equipo a
  otro, usa un respaldo.
