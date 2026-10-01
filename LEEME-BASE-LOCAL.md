# Pleaseme — Base de datos local (sin Supabase y sin servidor)

El sistema ya no usa Supabase ni necesita instalar nada. La aplicación crea su
propia base de datos **dentro del navegador de cada equipo**, con IndexedDB.
Funciona sin internet.

- Cada equipo, y cada navegador, tiene su propia base de datos.
- Usa siempre **el mismo navegador** y **la misma dirección** para abrir el
  sistema. Por ejemplo, siempre Chrome abriendo los mismos archivos o la misma
  página. Si cambias de navegador o de dirección, verás una base vacía.

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
  **📂 Restaurar respaldo** y elige ese archivo.
- **No uses** "Borrar datos de navegación / cookies y datos de sitios" en ese
  navegador.

## Ten en cuenta

- La **tienda online** y **Mi cuenta** también usan la base local. Solo ven los
  datos del navegador donde se abren; los clientes ya no pueden comprar desde
  internet.
- La información **no se comparte entre equipos**. Para copiarla de un equipo a
  otro, usa un respaldo.
