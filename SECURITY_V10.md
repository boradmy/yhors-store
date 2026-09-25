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

En Render, crea `YHORS_DATA_KEY` en **Environment**. La clave de producción puede ser distinta de la clave de tu `.env` local; lo importante es no cambiar la clave de un entorno después de que ese entorno ya tenga pedidos cifrados. No la guardes en GitHub, no la envíes por correo y no la pongas dentro del código.

Puedes generar una clave con Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Importante

Si `YHORS_DATA_KEY` falta o es incorrecta, V10 no debe arrancar o no podrá descifrar los pedidos. Esto es intencional: es preferible detener el servidor que volver a guardar datos sensibles en texto plano.

La clave debe conservarse con seguridad. Si se pierde, los pedidos cifrados no pueden recuperarse.


## Backups y restauración segura

Los respaldos se muestran del **más reciente al más antiguo**. La numeración representa la antigüedad: `Backup #1` es el más antiguo y el número mayor es el más reciente. Cada respaldo muestra la fecha y hora de creación en formato `DD-MM-YYYY-HHMM`.

La opción **Restaurar** está protegida por confirmación. Antes de reemplazar los datos actuales, V10 crea automáticamente un respaldo de seguridad con motivo `antes-de-restaurar`. Los pedidos del respaldo se mantienen cifrados y, si el respaldo fuese de una versión anterior, V10 intenta migrarlo al cifrado antes de aplicarlo.
