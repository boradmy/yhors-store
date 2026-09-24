# Correo de pedidos YHORS usando tu Gmail (sin dominio)

YHORS puede enviar la confirmación al correo que el cliente escriba usando una Web App de Google Apps Script. El mensaje se envía desde la cuenta Google que creó/desplegó el script.

## 1. Crear el script

1. Entra a Google Apps Script.
2. Crea un proyecto nuevo.
3. Pega el contenido de `google-apps-script.js`.
4. Cambia `YHORS_TOKEN` por una cadena larga inventada por ti.
5. Guarda el proyecto.

## 2. Publicarlo como Web App

En Apps Script: **Implementar → Nueva implementación → Aplicación web**.

- Ejecutar como: **Tú**
- Quién tiene acceso: **Cualquiera**

Copia la URL `/exec` que Google entregue.

## 3. Variables en Render

Configura estas variables:

- `GOOGLE_APPS_SCRIPT_URL` = URL `/exec` de tu Web App
- `GOOGLE_APPS_SCRIPT_TOKEN` = el mismo token que pusiste en el script
- `GOOGLE_NOTIFY_TO` = tu Gmail, si quieres recibir una copia oculta de cada pedido
- `GOOGLE_FROM_NAME` = `YHORS STORE`

No pongas tu contraseña normal de Gmail en YHORS.

## 4. Qué sucede cuando compra un cliente

Cliente escribe su correo → YHORS crea `#YH-XXXX` → YHORS llama al Web App → Google Apps Script usa `MailApp` → el cliente recibe el correo de confirmación.

Si `GOOGLE_NOTIFY_TO` está configurado, tu Gmail recibe una copia oculta.

El sistema también conserva compatibilidad con Resend si las variables `GOOGLE_APPS_SCRIPT_URL` y `GOOGLE_APPS_SCRIPT_TOKEN` no están configuradas.
