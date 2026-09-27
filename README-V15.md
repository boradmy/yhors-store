# YHORS V15.0 — Auditoría

## Incorporado
- Registro append-only de eventos relevantes en `data/audit.json`.
- No registra contraseñas, hashes, tokens, cookies ni secretos.
- Auditoría de inicios/cierres de sesión y fallos de login.
- Auditoría de usuarios: crear, actualizar y eliminar.
- Auditoría de pedidos: crear, actualizar y eliminar.
- Auditoría de inventario: crear y actualizar.
- Panel `/admin/auditoria` exclusivo para Administrador.
- Filtros por texto, usuario, acción, módulo y rango de fechas.
- Vista de detalle del evento.
- No existe botón para borrar registros desde la interfaz.

## Compatibilidad
Se mantiene la arquitectura V14: Passkeys, sesiones server-side, roles, límites de intentos, pedidos, inventario y demás funcionalidades existentes.

## Nota
`audit.json` se crea automáticamente cuando se registra el primer evento. No se incluye un archivo de auditoría histórico dentro de este paquete.
