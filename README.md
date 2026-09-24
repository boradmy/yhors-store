# YHORS Store

Tienda ligera para publicar en un hosting con Node.js. No lleva React, compilación ni `node_modules` dentro del proyecto: el catálogo público y el panel funcionan con HTML, CSS y JavaScript nativos.

## Qué incluye

- Catálogo adaptable para móvil, filtros por colección y carrito persistente en el navegador.
- Panel que no aparece en el menú público: `/yhors/admin593`.
- Inicio de sesión con usuario y contraseña configurables.
- Crear, editar, destacar y eliminar productos.
- Galería de hasta 4 fotos: cada posición admite subida de archivo o URL de imagen.
- Checkout integrado en una página independiente `/pedido`: el cliente completa sus datos, ubicación de Google Maps y modalidad de entrega.
- Pedidos persistentes con numeración `YH-0001`, `YH-0002`, etc.
- Panel administrativo de pedidos independiente, con filtros por fecha/estado/búsqueda, tarjetas compactas desplegables y eliminación de pedidos de prueba. Estados: Pendiente, Confirmado, Preparando, Enviado, Entregado y Cancelado.
- WhatsApp queda como canal opcional de atención, no como sistema principal de pedidos.
- Cabeceras de seguridad, cookie de sesión HTTP-only y validación del lado del servidor.

## Arranque local

1. Instala Node.js 20 o superior.
2. Duplica `.env.example`, llámalo `.env` y cambia, como mínimo, `ADMIN_PASSWORD` y `SESSION_SECRET`.
3. En esta carpeta ejecuta `npm install --omit=dev`.
4. Ejecuta `npm start` y abre `http://localhost:3000`.
5. Para administrar, entra directamente en `http://localhost:3000/yhors/admin593`.

No publiques el archivo `.env`, no compartas la ruta de administración y usa una contraseña larga y exclusiva. En un dominio HTTPS configura `COOKIE_SECURE=true`.

## Publicación

El proyecto necesita un alojamiento que ejecute Node.js, por ejemplo Render, Railway, Fly.io o un VPS. Configura las mismas variables del `.env` en el panel del hosting y usa:

```text
Build command: npm ci --omit=dev
Start command: npm start
```

Los productos se guardan en `data/products.json`, los pedidos en `data/orders.json` y las fotos en `uploads/`. **Debes montar almacenamiento persistente** para `data/` y `uploads/`; de lo contrario, las fotos y cambios se perderán al reiniciar o redesplegar. El `Dockerfile` declara ambos volúmenes para despliegues con Docker.

Para recibir pedidos, agrega el número internacional de WhatsApp sin `+` ni espacios a `WHATSAPP_NUMBER`, por ejemplo `573001234567`.

## Notas

- La moneda visible está configurada como USD. Puedes cambiarla en `public/app.js` dentro de la función `money`.
- Los cuatro productos iniciales son ejemplos. Entra al panel, edítalos o elimínalos y carga tus fotos reales.
- El hosting no debe servirse como sitio estático; requiere ejecutar `server.js` para que el acceso, la carga de fotos y los cambios sean reales.


## Mejoras de esta versión
- Homepage con estética YHORS más elegante: negro, crema y dorado, mejor jerarquía visual y tarjetas refinadas.
- Botón Añadir con estado de carga y confirmación visual.
- Carrito lateral con controles +/−, edición directa de cantidad y total actualizado.
- Tarjetas de catálogo clicables y página de detalle individual.
- Galería de hasta 4 imágenes por producto.
- Panel de administración ampliado para editar nombre, precio, categoría, descripción larga e imágenes.
- Los productos antiguos siguen funcionando: el backend convierte la imagen existente en una galería de una imagen.

### Importante
Se omitieron `.env`, `.git` y `node_modules` del ZIP por seguridad/tamaño. Copia tu `.env` original al proyecto y ejecuta `npm install` antes de iniciar.


## YHORS 3.0
- Header con categorías independientes: `/categoria/todo`, `/categoria/elegant`, `/categoria/sports`, `/categoria/tech`, `/categoria/cosplay`, `/categoria/pets`, `/categoria/details` y `/categoria/collectibles`.
- Portada editorial con slider configurable desde Administración.
- Selección de productos destacados configurable desde Administración.
- Footer compartido en las páginas públicas.
- Las selecciones se guardan en `data/storefront.json`.

## YHORS 4.0 — Organización del catálogo
- La pestaña pública `Todo` ahora se presenta como `Principal` y usa `/categoria/principal`.
- Administración organiza el inventario por universo: Elegant, Sports, Tech, Cosplay, Pets, Details y Coleccionables.
- Puedes crear tus propias **marcas** y **tipos de producto** por universo desde Administración.
- Tech incluye inicialmente Infinix y Lenovo, y Celular, Audífonos y Accesorios como ejemplos editables.
- Los productos admiten marca y tipo de producto.
- Cosplay tiene obligatoriamente **Precio de venta** y **Precio de alquiler**.
- Las clasificaciones se guardan en `data/classifications.json` y requieren almacenamiento persistente en el hosting.


## SEO e indexación de Google
- Cada producto público tiene una URL permanente `/producto/nombre-del-producto-sku` y las URLs antiguas `?producto=...` redirigen con 301.
- El servidor genera HTML inicial con título, descripción, canonical, Open Graph y datos estructurados `Product`/`Offer` para las fichas.
- `/sitemap.xml` se genera automáticamente a partir del catálogo y `/robots.txt` referencia ese sitemap.
- `/yhors-corp` crea una página pública para la identidad YHORS-CORP.
- Las búsquedas internas usan `noindex,follow` para evitar indexar miles de URLs de búsqueda.
- Después de publicar, agrega `https://TU-DOMINIO/sitemap.xml` en Google Search Console y usa la inspección de URL para la portada y varias fichas. La indexación y los resultados enriquecidos no son instantáneos ni garantizados por Google.
- `PUBLIC_BASE_URL` debe ser el dominio público real de producción (por ejemplo `https://yhors-store.onrender.com` o tu dominio propio).

### Caché del sitio
Los archivos HTML/CSS/JS se configuran para revalidarse automáticamente en cada visita. No es necesario borrar cookies o caché manualmente después de desplegar cambios.


### YHORS STORE — Sistema de pedidos integrado
El checkout ya no depende de Google Forms ni necesita abrir WhatsApp para registrar una compra. El cliente agrega productos al carrito, pulsa **Finalizar pedido**, completa nombre, teléfono, correo opcional, ciudad, dirección y notas, y recibe un número de pedido como `#YH-0001`.

Los pedidos se guardan en `data/orders.json`. El panel `/yhors/admin593` incluye la sección **Pedidos recibidos**, con búsqueda, filtro por estado y actualización del flujo:
`Pendiente → Confirmado → Preparando → Enviado → Entregado`
También existe `Cancelado` para pedidos que no continúen.

Para producción en Render, el almacenamiento persistente debe incluir la carpeta `data/`, además de `uploads/`, para conservar catálogo, clasificaciones, portada y pedidos después de reinicios o despliegues.


## Sistema de pedidos actualizado

- `/pedido`: checkout independiente en una pestaña nueva.
- Formas de entrega:
  - Retiro en oficina: $0
  - Envío YHORS: $3
  - Courier: $5
- El servidor calcula el subtotal, envío y total para evitar manipulación desde el navegador.
- `/yhors/admin593`: administración del catálogo.
- `/yhors/admin593/pedidos`: panel independiente para gestionar pedidos.
- Los pedidos pueden cambiar de estado y eliminarse desde el panel.
- Los pedidos se almacenan en `data/orders.json`.


## Pedidos y notificaciones por correo
- El checkout permite elegir **Retiro en oficina ($0)**, **Envío YHORS ($3)** o **Courier ($5)**.
- Puede solicitar una **Dirección vía Google Maps** para facilitar la entrega.
- Si el cliente proporciona correo y se configuran `RESEND_API_KEY` y `RESEND_FROM_EMAIL`, el servidor envía automáticamente una confirmación transaccional del pedido mediante Resend. Si no se configuran, el pedido igualmente se registra normalmente.

## Acceso secundario de pedidos

La aplicación admite una segunda cuenta con rol `orders`. Esta cuenta solo puede gestionar pedidos y no tiene acceso a productos, clasificaciones ni configuración de la página web.

Variables:
- `ORDERS_USER`
- `ORDERS_PASSWORD`

El usuario principal usa `ADMIN_USER` / `ADMIN_PASSWORD`.


## YHORS 11 — Persistencia y respaldos

Esta versión separa el **código** de los **datos** para que las futuras actualizaciones del proyecto no reemplacen el catálogo ni los pedidos.

### Cómo funciona

- En desarrollo local, YHORS sigue usando `data/` y `uploads/`.
- En producción, cuando `YHORS_STORAGE_DIR` está configurado, YHORS guarda allí:
  - `data/products.json`
  - `data/orders.json`
  - `data/storefront.json`
  - `data/classifications.json`
  - `uploads/`
  - `backups/`
- Si el almacenamiento persistente está vacío en la primera ejecución, YHORS copia los archivos que vienen con el código **solo si todavía no existen**. Después no vuelve a sobrescribirlos.
- Antes de modificaciones de datos, YHORS crea respaldos automáticos con un intervalo configurable (6 horas por defecto).
- El administrador también tiene un botón **Crear respaldo ahora** y puede descargar los últimos respaldos.
- Se conservan 30 respaldos por defecto. Puedes cambiarlo con `YHORS_BACKUP_RETENTION`.
- El respaldo contiene productos, pedidos, clasificaciones, portada y fotografías.

### Render — configuración recomendada

Para usar esta protección en Render:

1. Adjunta un **Persistent Disk** a tu Web Service.
2. Usa como mount path:
   `/var/data`
3. Configura la variable de entorno:
   `YHORS_STORAGE_DIR=/var/data/yhors`
4. Opcional:
   `YHORS_BACKUP_RETENTION=30`
5. Opcional:
   `YHORS_AUTO_BACKUP_INTERVAL_HOURS=6`

**Importante:** el Persistent Disk es el que hace que los archivos sobrevivan a reinicios y despliegues. El sistema de respaldos es una segunda capa de seguridad.

Render indica que los Persistent Disks solo están disponibles para servicios web/persistentes/background de pago y se cobran por almacenamiento; actualmente el precio publicado es **$0.25 por GB/mes**. Render también crea snapshots automáticos diarios del disco y los conserva al menos siete días.

### Flujo seguro para futuras versiones

Cuando hagamos una nueva versión de YHORS:

1. Se actualiza el código.
2. Se despliega la nueva versión.
3. `data/`, `uploads/` y `backups/` permanecen en el disco.
4. Los archivos persistentes existentes **no se reemplazan por los archivos del ZIP**.
5. Si alguna vez necesitas recuperar información, puedes descargar un respaldo desde Administración.

Antes de hacer cambios grandes, también puedes pulsar **Crear respaldo ahora**. Así tendrás un punto de recuperación independiente de la actualización.
