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
datos. Por eso hay que hacer respaldos.

- **Ya no hay respaldo diario.** El respaldo se hace solo cuando pulsas
  **🗄 BD local → 💾 Respaldar ahora** (o **Respaldar ahora** en el aviso).
- El respaldo se guarda en **Documentos\Pleaseme Respaldos** y ahí **solo hay
  un archivo**: al hacer un respaldo nuevo se borran los anteriores.
- **No uses** "Borrar datos de navegación / cookies y datos de sitios" en ese
  navegador.

### Carpeta Documentos\Pleaseme Respaldos

La primera vez que pulses **💾 Respaldar ahora** se abre la ventana de Windows
en **Documentos**: pulsa **Nueva carpeta**, llámala **Pleaseme Respaldos** y
elígela. El navegador no deja elegir "Documentos" en sí, por eso hace falta la
carpeta. (Si eliges otra carpeta, se crea "Pleaseme Respaldos" dentro de ella.)
La carpeta queda recordada.

```
Documentos\Pleaseme Respaldos\pleaseme-respaldo-2026-11-18.json   ← solo el último
```

- Solo se borran archivos de respaldo (`pleaseme-respaldo-….json` y las
  subcarpetas con fecha del sistema anterior). Cualquier otro archivo que pongas
  en la carpeta no se toca.
- En este equipo (dentro del navegador) también se guarda solo la última copia:
  **🕘 Copia en este equipo** la muestra y permite restaurarla.
- Si el navegador pide permiso otra vez (pasa a veces al reiniciarlo), concédelo.
  En Chrome/Edge puedes elegir "Permitir en cada visita".
- Requiere Google Chrome o Microsoft Edge. En otros navegadores el archivo se
  descarga a Descargas.
- Para restaurar: **🗄 BD local → 📂 Restaurar** y elige el archivo `.json`.
  Para pasar los datos a otro equipo, copia ese archivo (USB, nube…).

## Imprimir facturas directo (sin cuadro de imprimir)

Una página web no puede elegir la impresora por su cuenta. Para que **🖨 Imprimir**
mande la factura directo a la impresora predeterminada, sin cuadro de diálogo:

1. Descarga **configurar-impresion.bat**
   (https://lloammes81.github.io/pleaseme-accesories/configurar-impresion.bat).
   Si Edge avisa que el archivo puede ser peligroso, elige **Conservar**.
2. Haz doble clic. Si Windows muestra "Windows protegió su PC", pulsa
   **Más información → Ejecutar de todas formas**.
3. Elige la impresora de las facturas y pulsa Enter cuando lo pida (cierra Edge).
4. Desde entonces abre el sistema **siempre** con el acceso directo
   **Pleaseme Facturacion** del escritorio.

Ese acceso directo abre Edge con `--kiosk-printing`: todo lo que imprimas en esa
ventana de Edge va directo a la impresora predeterminada.

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
