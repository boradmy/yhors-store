# YHORS STORE — Seguridad V14.1

Esta versión conserva las mejoras recientes de usuarios y roles (`admin`, `store_manager`, `orders`) y recupera las protecciones de seguridad de V14.

## Recuperado / endurecido

- 2FA TOTP para las cuentas administradas.
- Rate limiting del login por usuario/IP y del desafío 2FA.
- Sesiones server-side con token aleatorio y expiración configurable.
- Invalidación de sesiones cuando una cuenta cambia de contraseña, rol o estado.
- `SESSION_SECRET` obligatorio y con mínimo de 32 caracteres.
- Cookies de sesión `HttpOnly`, `SameSite=Strict` y `Secure` según configuración.
- 2FA cifrado con AES-256-GCM usando una clave derivada de `SESSION_SECRET`.
- `security.json` incluido en backups y restauraciones.
- La navegación de administración queda: PÁGINA WEB → USUARIOS → PEDIDOS.
- La autorización sigue siendo del lado servidor; ocultar botones no se considera una medida de seguridad.

## Variables críticas

En producción configura `SESSION_SECRET` y `YHORS_DATA_KEY` con valores aleatorios fuertes. No subas `.env` al repositorio.

## 2FA

Desde **USUARIOS**, un administrador puede configurar 2FA para cada cuenta. La cuenta que tenga 2FA activado deberá introducir el código de 6 dígitos después de la contraseña.

## Nota sobre credenciales

El `.env` original contiene credenciales y tokens reales. Por seguridad, el paquete distribuido no incluye ese archivo. Usa `.env.example` como plantilla y configura los valores en el entorno de Render.
