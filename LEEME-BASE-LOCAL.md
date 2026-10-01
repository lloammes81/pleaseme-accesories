# Pleaseme — Base de datos local (sin Supabase)

El sistema ya no usa Supabase. Cada equipo guarda su información en un archivo
de base de datos propio:

```
datos/pleaseme.db          ← la base de datos (SQLite)
datos/respaldos/           ← copia automática de cada día (últimos 30 días)
```

La carpeta `datos/` **no se sube a GitHub**; vive solo en el equipo.

## 1. Instalar (una sola vez por equipo)

1. Instala **Node.js** versión LTS (22.13 o superior) desde <https://nodejs.org>.
2. Descarga o clona este repositorio en una carpeta del equipo.

## 2. Abrir el sistema

- **Windows:** doble clic en `iniciar-servidor.bat`
- **Mac:** doble clic en `iniciar-servidor.command`
  (la primera vez: clic derecho → Abrir)
- **Desde una terminal:** `npm start` o `node servidor/server.js`

Se abre una ventana negra (el servidor) y el navegador en
<http://localhost:3000/admin.html>. **Deja esa ventana abierta** mientras uses el
sistema; si la cierras, las páginas no pueden guardar.

| Página       | Dirección                              |
|--------------|----------------------------------------|
| Admin        | http://localhost:3000/admin.html       |
| Facturación  | http://localhost:3000/index.html       |
| Tienda       | http://localhost:3000/tienda.html      |
| Mi cuenta    | http://localhost:3000/account.html     |

## 3. Pasar la información que ya tienes (botón ⇪ Enviar a BD local)

Con el servidor abierto:

1. Abre el sistema **como lo usabas antes** (la misma dirección o el mismo
   archivo, en el mismo navegador), porque ahí están guardados tus registros.
2. Pulsa **⇪ Enviar a BD local**: en Facturación está arriba, junto a
   "Información Compañía"; en Admin está junto al indicador de base de datos.
3. El botón copia a la base local:
   - todo lo que estaba en Supabase: facturas, clientes, productos, pedidos,
     configuración, usuarios y transportistas;
   - los registros guardados en ese navegador, incluidas las facturas que
     nunca llegaron a Supabase;
   - los ajustes que solo vivían en el navegador: contraseña del admin,
     compras, configuración de envíos, etc.
4. Al terminar, pulsa **Abrir el sistema local →**.

La migración **no borra nada**: agrega los registros que falten y, en los que ya
existen, solo completa campos vacíos. Puedes repetirla sin riesgo; por ejemplo,
una vez en cada navegador o equipo donde tengas datos.

> Si el botón dice que no encuentra el servidor, verifica que la ventana del
> servidor esté abierta. Safari a veces bloquea la conexión desde una página
> `https://` hacia `localhost`; en ese caso haz la migración con Chrome o Edge.

## Respaldos

- Copia diaria automática en `datos/respaldos/`.
- Respaldo manual: abre <http://localhost:3000/api/exportar> para descargar
  todo en un archivo `.json`.
- Para mover la información a otro equipo, copia la carpeta `datos/` completa
  con el servidor cerrado.

## Importante

- La **tienda online** y **Mi cuenta** ahora también usan la base local. Solo
  funcionan en el equipo donde está abierto el servidor; los clientes ya no
  pueden comprar desde internet.
- Para usar el sistema desde otro equipo o teléfono de la misma red Wi-Fi, abre
  el servidor con `HOST=0.0.0.0 node servidor/server.js` y entra con la IP del
  equipo (ej. `http://192.168.1.20:3000`). Hazlo solo en una red de confianza:
  cualquiera en esa red podría ver los datos.
