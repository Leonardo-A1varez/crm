# Rotación de secretos

## Alcance y cadencia

Rotar cada 90 días, y de inmediato ante sospecha de exposición: `META_APP_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_SIGNING_KEY` y las claves HMAC de las bajas de difusión (`DIFUSION_BAJAS_HMAC_CLAVES`). Estas últimas no siguen el procedimiento general: ver [su sección](#claves-hmac-de-las-bajas-de-difusión).

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

## Claves HMAC de las bajas de difusión

`difusion_supresiones` no guarda el teléfono: guarda `telefono_hash` = HMAC-SHA256 del número (E.164 sin `+`) con una clave del servidor, y `clave_version` = qué versión de la clave lo calculó. La clave no está en la base; el hash se calcula en `src/server/repositories/difusion-supresiones.hash.ts`.

### Configuración

Dos variables, en `.env.local` para desarrollo y en Vercel (Project Settings → Environment Variables, Production y Preview) para los despliegues. No se commitean.

| Variable                             | Contenido                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `DIFUSION_BAJAS_HMAC_CLAVES`         | `version:claveBase64` separadas por coma, p. ej. `1:<base64>,2:<base64>`.   |
| `DIFUSION_BAJAS_HMAC_VERSION_ACTIVA` | La versión con que se escriben las altas. Tiene que estar entre las claves. |

Generar una clave (32 bytes): `openssl rand -base64 32`.

- Las **altas** se escriben con la versión activa. Las **búsquedas** calculan el hash con **todas** las versiones de la lista: una baja escrita con la versión 1 sigue bloqueando cuando la activa es la 2.
- Si faltan las dos variables, la app arranca igual, pero registrar o consultar una baja lanza `IllegalStateError`, y todo lo que depende de la lista **falla cerrado**: la difusión no se planifica ni se programa, `enviar_mensaje` de un flujo no manda y la palabra "BAJA" hace fallar el turno. Nada se envía sin revisar las bajas.
- Si viene una sola de las dos, una clave de menos de 32 bytes, algo que no es base64 o una versión activa que no está en la lista, el boot falla (`src/lib/env.ts`). El mensaje dice qué versión está mal, nunca el valor.

### Rotación (cada 90 días)

Dos despliegues, para que ninguna instancia vieja deje de ver una baja escrita por una nueva:

1. **Agregar** la versión nueva a `DIFUSION_BAJAS_HMAC_CLAVES` sin cambiar la activa: `1:<vieja>,2:<nueva>` con `DIFUSION_BAJAS_HMAC_VERSION_ACTIVA=1`. Desplegar. Ahora todas las instancias buscan con las dos.
2. **Activar** la nueva: `DIFUSION_BAJAS_HMAC_VERSION_ACTIVA=2`. Desplegar. Las altas nuevas salen con la 2.
3. Validar: registrar una baja de prueba y confirmar `clave_version = 2`; buscar un número dado de baja antes de rotar y confirmar que sigue bloqueado. No hay endpoint para esto: correr `npx vitest run tests/unit/difusion-repos.in-memory.test.ts` cubre la lógica, y contra la base se verifica con `select clave_version, count(*) from difusion_supresiones group by 1`.
4. Registrar la fecha de la próxima rotación. No registrar el valor.

### Retirar una versión vieja

**Una versión no se retira mientras haya bajas activas con ella.** Sacarla de la lista hace que esas bajas dejen de bloquear, sin error y sin aviso: se le vuelve a mandar marketing a alguien que pidió que no.

Antes de retirar la versión N:

```sql
select count(*) from public.difusion_supresiones
 where clave_version = N and reactivada_at is null;
```

Si da 0, se puede sacar de la lista. Las filas reactivadas con esa versión quedan como historial y ya no hace falta encontrarlas.

**Sin el teléfono original no hay forma de pasar una baja de la versión N a otra.** El HMAC no se invierte (ese es su propósito) y la tabla no guarda el número. Además, el trigger `difusion_supresiones_irreversible` impide editar `telefono_hash` y `clave_version`. En la práctica, una versión con bajas activas **no se retira nunca**. Queda en la lista mientras exista una baja activa con ella, y mantenerla cuesta un cálculo más de HMAC por teléfono buscado. Re-hashear con los teléfonos de los leads que siguen vivos exigiría abrir una puerta controlada en el trigger, y aun así no alcanzaría a las bajas de leads borrados o anonimizados, que son justo las que más importan.

### Si una clave se filtró

Rotar no protege las filas que ya existen: quien tenga la clave N puede recorrer por fuerza bruta los teléfonos de las filas con `clave_version = N`, porque el universo de números es chico. Hay que activar una versión nueva de inmediato para que no se escriban más filas con la clave expuesta, tratarlo como incidente de datos personales (sección siguiente y `docs/data-retention.md` §8), y tener en cuenta que la versión expuesta no se puede retirar mientras tenga bajas activas (ver arriba).

## Incidente

Si un secreto pudo filtrarse, no esperar a la ventana de 90 días: revocarlo, desplegar el reemplazo, revisar accesos y abrir el proceso de incidente de seguridad y privacidad.
