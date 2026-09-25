# YHORS V14.2 — Passkeys / WebAuthn

## Cambios
- Se reemplaza el flujo de inicio 2FA/TOTP de la interfaz por Passkeys/WebAuthn.
- Login disponible con contraseña o Passkey.
- Passkeys usan Windows Hello, huella, Face ID o el autenticador compatible del dispositivo.
- El servidor nunca recibe ni almacena datos biométricos.
- Las credenciales WebAuthn se guardan en `data/security.json` como ID, clave pública y contador.
- El administrador puede permitir/bloquear el inicio con Passkey por usuario y revocar las Passkeys registradas.
- El usuario puede registrar varias Passkeys desde `/mi-cuenta`, cambiar su contraseña y revocar sus dispositivos.
- Las contraseñas siguen siendo hashes bcrypt y nunca se muestran al administrador.
- Se conservan rate limiting y sesiones server-side de V14.1.

## Producción
- `PUBLIC_BASE_URL` debe ser la URL HTTPS real de YHORS.
- `SESSION_SECRET` debe tener al menos 32 caracteres.
- `YHORS_DATA_KEY` debe estar configurada.
- WebAuthn valida `expectedOrigin` y `expectedRPID` contra `PUBLIC_BASE_URL`.

## Nota
La librería de servidor es `@simplewebauthn/server` y la interfaz usa el bundle oficial de `@simplewebauthn/browser`.


## V14.3 UI/Passkey fixes
- Passkeys ahora usa WebAuthn nativo del navegador; se eliminó la dependencia de un script UMD externo bloqueado por la CSP.
- El menú de cuenta usa un único icono de usuario con Mi cuenta y Cerrar sesión.
- Todos los roles, incluido Administrador, tienen acceso a Mi cuenta y pueden cambiar su propia contraseña.
- Cambiar contraseña revoca las demás sesiones y conserva la sesión actual mediante una nueva sesión segura.
