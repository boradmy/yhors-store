# YHORS-STORE V10 — protección de datos

## Cifrado de pedidos

V10 cifra en reposo los campos personales de los pedidos con **AES-256-GCM**. La clave se obtiene exclusivamente de `YHORS_DATA_KEY` y no se guarda dentro de `data/orders.json`.

Campos protegidos:
- nombre
- teléfono
- cédula/RUC
- correo
- ciudad
- dirección
- enlace de Google Maps
- notas del cliente
- nota interna del pedido

Los datos se descifran solamente en memoria cuando el servidor necesita mostrarlos al panel administrativo o construir el correo de confirmación.

## Migración automática

Al iniciar V10, los pedidos antiguos que estén en texto plano se migran automáticamente al formato cifrado. También se revisan los `orders.json` de los respaldos existentes.

La migración se realiza antes del backup automático inicial para evitar crear una copia nueva en texto plano.

## Clave

En local, agrega a `.env`:

```text
YHORS_DATA_KEY=una_clave_larga_y_aleatoria
```

En Render, crea la misma variable en **Environment**. No la guardes en GitHub, no la envíes por correo y no la pongas dentro del código.

Puedes generar una clave con Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Importante

Si `YHORS_DATA_KEY` falta o es incorrecta, V10 no debe arrancar o no podrá descifrar los pedidos. Esto es intencional: es preferible detener el servidor que volver a guardar datos sensibles en texto plano.

La clave debe conservarse con seguridad. Si se pierde, los pedidos cifrados no pueden recuperarse.
