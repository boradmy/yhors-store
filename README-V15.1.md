# YHORS V15.1 — Auditoría detallada

- Registro server-side de acciones de seguridad, usuarios, pedidos e inventario.
- Cada evento tiene ID AUD-..., fecha/hora, usuario, rol, IP, user-agent, módulo, acción, resultado y detalles.
- Cambios de pedidos e inventario registran diferencias antes/después.
- Panel exclusivo del Administrador en /yhors/admin593/auditoria.
- Filtros por texto, usuario, módulo, acción y rango de fechas.
- Los eventos no tienen opción de borrado desde la interfaz.
- No se registran contraseñas, hashes, tokens, cookies ni secretos.
- Máximo 50.000 eventos conservados en el archivo local; PostgreSQL queda para V16.
