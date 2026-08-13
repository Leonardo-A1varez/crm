# Rotación de secretos

## Alcance y cadencia

Rotar cada 90 días, y de inmediato ante sospecha de exposición: `META_APP_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `INNGEST_SIGNING_KEY`.

No pegar valores en tickets, chats, logs ni commits. Registrar solo el identificador, el responsable y la fecha de rotación en el sistema de auditoría del cliente.

## Procedimiento

1. Designar ventana y responsable; verificar que existe rollback y un contacto de cada proveedor.
2. Generar el secreto nuevo en el proveedor. Mantener el anterior únicamente durante la ventana de transición que soporte ese proveedor.
3. Actualizar el secreto en Vercel para los entornos correspondientes. Nunca usar un valor `NEXT_PUBLIC_*`.
4. Desplegar y validar `/api/health`; ejecutar una prueba mínima no destructiva del proveedor afectado.
5. Revocar el secreto anterior en el proveedor y confirmar que no sigue activo.
6. Registrar fecha de próxima rotación (90 días), proveedor, entorno y responsable. No registrar el valor.

## Validaciones por proveedor

| Secreto                     | Validación mínima                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `META_APP_SECRET`           | Webhook firmado válido devuelve 200 y firma inválida devuelve 401.                   |
| `OPENAI_API_KEY`            | Una llamada controlada del flujo LLM registra uso sin exponer contenido del cliente. |
| `SUPABASE_SERVICE_ROLE_KEY` | Health check de DB y una operación de servidor autorizada. Nunca desde el navegador. |
| `INNGEST_SIGNING_KEY`       | Endpoint de Inngest acepta una invocación firmada y rechaza una inválida.            |

## Incidente

Si un secreto pudo filtrarse, no esperar a la ventana de 90 días: revocarlo, desplegar el reemplazo, revisar accesos y abrir el proceso de incidente de seguridad y privacidad.
