# YHORS Store

Tienda ligera para publicar en un hosting con Node.js. No lleva React, compilación ni `node_modules` dentro del proyecto: el catálogo público y el panel funcionan con HTML, CSS y JavaScript nativos.

## Qué incluye

- Catálogo adaptable para móvil, filtros por colección y carrito persistente en el navegador.
- Panel que no aparece en el menú público: `/yhors/admin593`.
- Inicio de sesión con usuario y contraseña configurables.
- Crear, editar, destacar y eliminar productos.
- Carga de fotos JPG, PNG, WEBP o GIF de hasta 5 MB, o uso de una URL de imagen.
- Pedido por WhatsApp al configurar el número de la tienda.
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

Los productos se guardan en `data/products.json` y las fotos en `uploads/`. **Debes montar almacenamiento persistente** para esas dos carpetas; de lo contrario, las fotos y cambios se perderán al reiniciar o redesplegar. El `Dockerfile` declara ambos volúmenes para despliegues con Docker.

Para recibir pedidos, agrega el número internacional de WhatsApp sin `+` ni espacios a `WHATSAPP_NUMBER`, por ejemplo `573001234567`.

## Notas

- La moneda visible está configurada como USD. Puedes cambiarla en `public/app.js` dentro de la función `money`.
- Los cuatro productos iniciales son ejemplos. Entra al panel, edítalos o elimínalos y carga tus fotos reales.
- El hosting no debe servirse como sitio estático; requiere ejecutar `server.js` para que el acceso, la carga de fotos y los cambios sean reales.
