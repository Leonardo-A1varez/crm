# Cierre de brechas de la auditoría — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Goal:** Cerrar los defectos y riesgos encontrados en la auditoría del 2026-08-12: el doble envío al cliente en `sendOutbound`, la ausencia de guarda contra vaciar la base de dev, tres deudas de correctitud menores, y la decadencia de los docs de referencia técnica.

**Architecture:** El defecto central se arregla invirtiendo el orden de `sendOutbound`: reservar la fila en `mensajes` **antes** de llamar a Meta, llamar a Meta, y completar la fila con el `meta_message_id` devuelto. La decisión de reintentar se toma con la taxonomía de errores que el cliente Graph ya produce: `ValidationError` y `RateLimitError` significan que Meta rechazó explícitamente (no llegó nada al cliente), `InfraError` significa desenlace desconocido (Meta pudo haberlo aceptado). Solo el primer grupo permite reenviar. El resto del plan son cambios acotados e independientes entre sí.

**Tech Stack:** TypeScript 5 strict · Next.js 16 App Router · Supabase Postgres 17 · Inngest 4 · Vitest 4 · Zod 4.

---

## Global Constraints

Estas reglas aplican a **todas** las tareas. Vienen de `AGENTS.md §0` y §4 y no son negociables.

- **Idioma:** UI, comentarios y mensajes de commit en **español**. Identificadores técnicos genéricos en inglés (`leadId`, `messageRepo`); identificadores de dominio en español (`lead_session`, `motivo_perdida`).
- **Commits:** Conventional Commits, subject ≤72 caracteres, en español. El hook `commit-msg` lo valida.
- **`git add` con rutas explícitas SIEMPRE.** Nunca `git add -A`, nunca `git commit -a`, nunca `git stash` sin `--`. El hook `pre-commit` typechequea todo el proyecto y un archivo ajeno a medio escribir frena el commit.
- **Prohibido `throw new Error('msg')` en `src/server/**`.** Usar las clases de `src/lib/errors.ts`: `ValidationError`, `NotFoundError`, `ConflictError`, `PermissionDeniedError`, `IllegalStateError`, `BudgetExceededError`, `InfraError`, `RateLimitError`.
- **Prohibido `console.log` en `src/**`.** Solo `logger.info|warn|error|debug`.
- **Prohibido loggear PII:** nunca `telefono`, `mensaje.contenido`, `email` ni `meta_user_ids` en crudo.
- **No saltar capas.** API/Action → Service → Repository → DB. Los services no tocan la DB directo.
- **⛔ NO correr `npm run test:integration`.** Vacía la base de dev (`SUPABASE_TEST_URL` apunta al mismo proyecto Supabase que la app). La Tarea 5 de este plan existe justamente para desactivar esa bomba.
- **⛔ NO correr `npm run build` con el dev server levantado.** Corrompe `.next/`. Si hay que buildear: matar el árbol de procesos, borrar `.next`, después buildear.
- **⛔ NO enviar mensajes reales por Meta** en ninguna tarea de este plan. Todos los tests usan `FakeMetaApiClient` o `fetchImpl` inyectado.
- **Tests antes que implementación.** Red → green → refactor.
- **Un número en un comentario es una afirmación de hecho.** O se deja el comando que lo reproduce, o no se escribe el número.

### Comandos de verificación

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run format:check
```

Baseline medido el 2026-08-12 antes de empezar este plan: **1595 tests en 133 archivos, todos pasan**; typecheck, lint y format en verde; cobertura 87.32 / 78.62 / 82.75 / 88.32 contra umbral 80/75/80/80.

---

## Alcance: qué entra y qué no

**Entra (Fases 0 a 4 — ejecutables por un agente):**

- Salvar el trabajo sin commitear, incluidas dos migraciones untracked que **ya están aplicadas** en `crm-dev`.
- Cerrar la ventana de doble envío en `sendOutbound`.
- Envolver los fallos de red del cliente Graph en `InfraError`.
- Guarda que impide correr los tests de integración contra la base de la app.
- `server_now` con `search_path` fijo (advisor WARN de Supabase).
- Lock de sesión en `approveMerge`.
- Borrar `CloseSessionButton.tsx`, que no lo importa nadie.
- Reconstruir `docs/workflows.md` y `docs/data-model.md` desde el código, y saldar el hueco de mayo→agosto en `docs/changelog.md`.

**No entra (Fases 5, 6 y 7 — dependen del dueño, están al final como checklists, no como tareas TDD):**

- Cargar catálogo y empresa: hacen falta datos reales que el agente no tiene.
- Crear el segundo proyecto Supabase para tests: lo tiene que crear el dueño.
- Smoke autenticado de las RPC y `EXPLAIN`: requieren sesión y base con volumen.
- QA visual humana: por definición no la hace un agente.
- Deploy a Vercel, Sentry con DSN, número real de WhatsApp.

**Por qué un solo plan y no cinco:** las tareas de las Fases 0 a 4 son chicas e independientes entre sí, pero comparten una condición de arranque (el árbol sucio de la Fase 0) y un mismo criterio de cierre. Partirlas en documentos separados obligaría a repetir el contexto cinco veces. Las fases dependientes del dueño están explícitamente separadas del cuerpo TDD para que nadie las confunda con trabajo ejecutable.

---

## Estructura de archivos

| Archivo                                                              | Responsabilidad                                                                                       | Tarea |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| `src/server/repositories/messages.repo.ts`                           | Interface `MessagesRepository` + `InMemoryMessagesRepository`. Se le agregan tres métodos de reserva. | 2     |
| `src/server/repositories/messages.supabase.repo.ts`                  | Impl Supabase de los tres métodos nuevos.                                                             | 2     |
| `tests/repositories/messages.contract.ts`                            | Contract reusable in-memory ↔ Supabase. Cubre los tres métodos nuevos.                                | 2     |
| `src/server/services/meta-api.service.ts`                            | `sendOutbound` reserva → envía → confirma. Es el corazón del arreglo.                                 | 3     |
| `tests/unit/meta-api-idempotency.test.ts`                            | Tests de la ventana de doble envío.                                                                   | 3     |
| `tests/mocks/meta.ts`                                                | `FakeMetaApiClient` gana un `failWith` para simular rechazos de Meta.                                 | 3     |
| `src/server/services/meta/graph-api-client.ts`                       | Envuelve los fallos de `fetch` en `InfraError`.                                                       | 4     |
| `tests/unit/meta/graph-api-client.test.ts`                           | Test del fallo de red.                                                                                | 4     |
| `tests/integration/setup.ts`                                         | Guarda que impide correr contra la base de la app.                                                    | 5     |
| `tests/unit/integration-setup-guard.test.ts`                         | Test de la guarda (nuevo archivo).                                                                    | 5     |
| `supabase/migrations/20260813090000_server_now_search_path.sql`      | Fija `search_path` de `server_now()`.                                                                 | 6     |
| `src/server/services/leads/merge-executor.service.ts`                | `approveMerge` dentro de `SessionLock`.                                                               | 7     |
| `src/components/inbox/CloseSessionButton.tsx`                        | Se borra.                                                                                             | 8     |
| `docs/workflows.md`                                                  | Reescrito desde `src/inngest/functions/`.                                                             | 9     |
| `docs/data-model.md`                                                 | Tabla de migraciones reconstruida desde `supabase/migrations/`.                                       | 10    |
| `docs/changelog.md`, `docs/idempotency.md`, `AGENTS.md`, `README.md` | Hueco mayo→agosto, contradicciones y cifras del piloto.                                               | 11    |

---

# FASE 0 — Salvar el trabajo

### Task 1: Commitear y pushear el checkpoint QA

**Por qué primero:** hay 96 archivos modificados, 15 rutas untracked y 40 commits sin pushear. Dos de esas rutas untracked son `supabase/migrations/20260812170131_inbox_active_summary.sql` y `supabase/migrations/20260812222808_qa_handoff_metrics.sql`, y **las dos ya están aplicadas en `crm-dev`**. Si se pierde este árbol, la base remota queda con un esquema que ningún repo puede reproducir. Es lo único irrecuperable del proyecto.

**Files:**

- Sin cambios de código. Solo operaciones de Git.

**Interfaces:**

- Consume: nada.
- Produce: un árbol limpio sobre el que trabajan todas las tareas siguientes.

- [ ] **Step 1: Confirmar que no hay secretos en lo que se va a agregar**

`.claude/` está untracked. Verificar que contiene solo `launch.json` y ningún token:

```bash
find .claude -type f
```

Esperado: exactamente una línea, `.claude/launch.json`. Si aparece cualquier otro archivo, abrirlo y confirmar que no tiene credenciales antes de seguir. `backups/` y `.env*` ya están en `.gitignore` (líneas 34 y 64) y no deben aparecer nunca en el `git status` de abajo.

- [ ] **Step 2: Revisar qué se va a commitear**

```bash
git status --porcelain
```

Esperado: ~96 líneas ` M` y 15 líneas `??`. Ninguna debe empezar con `backups/` ni con `.env.local`.

- [ ] **Step 3: Agregar con rutas explícitas**

Nunca `-A`. Estas son las rutas:

```bash
git add .env.local.example .gitignore AGENTS.md README.md docs src supabase/migrations tests .claude vitest.integration.config.ts
```

- [ ] **Step 4: Verificar que el índice quedó como se espera**

```bash
git status --porcelain
```

Esperado: todas las líneas empiezan con `A ` o `M ` (primera columna, índice). No debe quedar nada en la segunda columna salvo archivos que se hayan decidido dejar afuera a propósito.

- [ ] **Step 5: Commitear**

El hook `pre-commit` corre typecheck de todo el proyecto y lint-staged. Si falla, no forzar: leer el error y arreglarlo.

```bash
git commit -m "feat: checkpoint QA de flujos y metricas"
```

- [ ] **Step 6: Pushear los 41 commits**

```bash
git push origin master
```

- [ ] **Step 7: Confirmar que no quedó nada sin subir**

```bash
git rev-list --count origin/master..master
```

Esperado: `0`.

---

# FASE 1 — Correctitud: la ventana de doble envío

> **Contexto para quien ejecute esta fase.** Hoy `sendOutbound` llama a la API de Meta y **después** escribe en `mensajes`. Si esa escritura falla, Inngest reintenta el step, el pre-check por `idempotency_key` no encuentra nada porque nunca se escribió, y se llama a Meta de nuevo: el cliente recibe el mismo WhatsApp dos veces. Está documentado en `docs/idempotency.md:42` desde Slice 1 con la nota "Mitigación pending Fase 7 … Investigar", esa fase cerró hace tres meses, y desde el 2026-08-07 hay WhatsApp real conectado. El mismo camino lo usa el aviso de escalado (`src/inngest/functions/handoff-notification.ts`), así que un handoff automático puede avisarle dos veces al cliente.
>
> **El intercambio que hace este arreglo, explícito:** un mensaje duplicado no se puede retirar; una fila reservada que quedó sin confirmar sí se ve y se puede resolver. Convertimos un daño irreversible e invisible en uno reversible y visible. La fila sin confirmar se marca `estado_entrega='fallido'` con el error, y eso **ya lo pinta la UI** en `src/components/inbox/MessageBubble.tsx:45` y `:206` — no hay que construir ningún visor nuevo.

### Task 2: Métodos de reserva en `MessagesRepository`

**Files:**

- Modify: `src/server/repositories/messages.repo.ts` (interface `MessagesRepository` en línea 68 + `InMemoryMessagesRepository` en línea 115)
- Modify: `src/server/repositories/messages.supabase.repo.ts`
- Test: `tests/repositories/messages.contract.ts`

**Interfaces:**

- Consume: `Mensaje`, `UUID` de `@/types/entities`; `ConflictError` de `@/lib/errors`.
- Produce: tres métodos nuevos en `MessagesRepository`, que consume la Tarea 3:
  - `confirmarEnvio(id: UUID, metaMessageId: string): Promise<Mensaje>`
  - `marcarFalloEnvio(id: UUID, error: string): Promise<Mensaje>`
  - `liberarReserva(id: UUID): Promise<void>`

**Por qué tres métodos con nombre propio y no un `update` genérico:** el repo ya sigue ese patrón (`aplicarEstadoEntrega`). Un `update` genérico sobre `mensajes` es un arma cargada — permitiría reescribir `contenido` o `lead_session_id` de un mensaje ya entregado. Estos tres solo tocan lo que su nombre dice, y `liberarReserva` se niega a borrar cualquier fila que ya tenga `meta_message_id`.

- [ ] **Step 1: Escribir los tests que fallan, en el contract**

Los contract tests corren contra las dos implementaciones (in-memory y Supabase), así que un solo cuerpo de test cubre ambas. Agregar al final del `describe("MessagesRepository contract", ...)` en `tests/repositories/messages.contract.ts`, justo antes de la llave que lo cierra.

El archivo **no** tiene un helper `makeMensaje`: la fábrica de fixtures se llama `baseInsert(fixtures, overrides)` (línea 24), y `repo` y `fixtures` son variables del `describe` que el `beforeEach` de la línea 51 rellena. Los tests de abajo usan ese patrón, igual que sus vecinos.

```typescript
test("confirmarEnvio escribe meta_message_id sobre una reserva", async () => {
  const reserva = await repo.create(
    baseInsert(fixtures, {
      direction: "out",
      sender: "ia",
      meta_message_id: null,
      idempotency_key: "out:ABC",
    }),
  );

  const confirmado = await repo.confirmarEnvio(reserva.id, "wamid.REAL");

  expect(confirmado.meta_message_id).toBe("wamid.REAL");
  expect(confirmado.id).toBe(reserva.id);
  expect(await repo.findByMetaMessageId("wamid.REAL")).not.toBeNull();
});

test("marcarFalloEnvio deja la fila visible como fallida con el motivo", async () => {
  const reserva = await repo.create(
    baseInsert(fixtures, {
      direction: "out",
      sender: "ia",
      meta_message_id: null,
      idempotency_key: "out:DEF",
    }),
  );

  const fallida = await repo.marcarFalloEnvio(reserva.id, "Meta 503");

  expect(fallida.estado_entrega).toBe("fallido");
  expect(fallida.error_entrega).toBe("Meta 503");
  expect(fallida.estado_entrega_at).not.toBeNull();
});

test("liberarReserva borra la fila y libera la idempotency_key", async () => {
  const reserva = await repo.create(
    baseInsert(fixtures, {
      direction: "out",
      sender: "ia",
      meta_message_id: null,
      idempotency_key: "out:GHI",
    }),
  );

  await repo.liberarReserva(reserva.id);

  expect(await repo.findById(reserva.id)).toBeNull();
  expect(await repo.findByIdempotencyKey("out:GHI")).toBeNull();
});

test("liberarReserva se niega a borrar un mensaje ya confirmado", async () => {
  const enviado = await repo.create(
    baseInsert(fixtures, {
      direction: "out",
      sender: "ia",
      meta_message_id: "wamid.YA",
      idempotency_key: "out:JKL",
    }),
  );

  await expect(repo.liberarReserva(enviado.id)).rejects.toThrow(ConflictError);
  expect(await repo.findById(enviado.id)).not.toBeNull();
});
```

`ConflictError` no está importado en ese archivo (sus imports son `vitest`, `MensajeInsert`/`MessagesRepository` y `UUID`). Agregarlo:

```typescript
import { ConflictError } from "@/lib/errors";
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run tests/unit/messages-supabase-repo.test.ts tests/repositories -t "reserva"
```

Esperado: FAIL. El error concreto es de TypeScript / runtime: `repo.confirmarEnvio is not a function`.

- [ ] **Step 3: Declarar los tres métodos en la interface**

En `src/server/repositories/messages.repo.ts`, dentro de `export interface MessagesRepository`, justo antes de `aplicarEstadoEntrega`:

```typescript
  /**
   * Completa una reserva con el id que devolvió Meta.
   *
   * Existe porque el saliente se escribe ANTES de llamar a Meta: si se
   * escribiera después, un fallo de la escritura haría que el reintento
   * volviera a llamar a Meta y el cliente recibiera el mensaje dos veces.
   */
  confirmarEnvio(id: UUID, metaMessageId: string): Promise<Mensaje>;
  /**
   * Deja la reserva marcada como fallida con el motivo.
   *
   * `MessageBubble` ya pinta `estado_entrega === "fallido"` junto con
   * `error_entrega`, así que un envío que no se pudo confirmar se ve en el
   * hilo sin construir nada nuevo.
   */
  marcarFalloEnvio(id: UUID, error: string): Promise<Mensaje>;
  /**
   * Borra una reserva que Meta rechazó explícitamente, liberando su
   * `idempotency_key` para que el reintento pueda volver a intentar.
   *
   * Lanza `ConflictError` si la fila ya tiene `meta_message_id`: eso significa
   * que Meta la aceptó y borrarla perdería el mensaje.
   */
  liberarReserva(id: UUID): Promise<void>;
```

- [ ] **Step 4: Implementar en `InMemoryMessagesRepository`**

En el mismo archivo, dentro de la clase, antes de `aplicarEstadoEntrega`:

```typescript
  async confirmarEnvio(id: UUID, metaMessageId: string): Promise<Mensaje> {
    const m = this.store.get(id);
    if (!m) throw new NotFoundError(`mensaje no encontrado: ${id}`, "mensaje", id);
    m.meta_message_id = metaMessageId;
    return cloneMensaje(m);
  }

  async marcarFalloEnvio(id: UUID, error: string): Promise<Mensaje> {
    const m = this.store.get(id);
    if (!m) throw new NotFoundError(`mensaje no encontrado: ${id}`, "mensaje", id);
    m.estado_entrega = "fallido";
    m.estado_entrega_at = new Date();
    m.error_entrega = error;
    return cloneMensaje(m);
  }

  async liberarReserva(id: UUID): Promise<void> {
    const m = this.store.get(id);
    if (!m) return;
    if (m.meta_message_id !== null) {
      throw new ConflictError(
        `mensaje ya confirmado por Meta, no se libera: ${id}`,
        "reserva_confirmada",
      );
    }
    this.store.delete(id);
  }
```

Agregar `NotFoundError` al import de la línea 1 del archivo:

```typescript
import { ConflictError, NotFoundError } from "@/lib/errors";
```

- [ ] **Step 5: Implementar en `SupabaseMessagesRepository`**

En `src/server/repositories/messages.supabase.repo.ts`, dentro de la clase, antes de `aplicarEstadoEntrega` (línea 230). `mapRow`, `MensajeRow` y `mapPostgrestError` ya están en el archivo.

```typescript
  async confirmarEnvio(id: UUID, metaMessageId: string): Promise<Mensaje> {
    const { data, error } = await this.db
      .from("mensajes")
      .update({ meta_message_id: metaMessageId })
      .eq("id", id)
      .select()
      .single();
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return mapRow(data as MensajeRow);
  }

  async marcarFalloEnvio(id: UUID, error: string): Promise<Mensaje> {
    const { data, error: dbError } = await this.db
      .from("mensajes")
      .update({
        estado_entrega: "fallido",
        estado_entrega_at: new Date().toISOString(),
        error_entrega: error,
      })
      .eq("id", id)
      .select()
      .single();
    if (dbError) throw mapPostgrestError(dbError, { resource: "mensajes" });
    return mapRow(data as MensajeRow);
  }

  async liberarReserva(id: UUID): Promise<void> {
    const actual = await this.findById(id);
    if (!actual) return;
    if (actual.meta_message_id !== null) {
      throw new ConflictError(
        `mensaje ya confirmado por Meta, no se libera: ${id}`,
        "reserva_confirmada",
      );
    }
    // El filtro `is null` sobre meta_message_id repite la guarda en SQL: entre
    // el findById y este delete pudo entrar la confirmación del envío.
    const { error } = await this.db
      .from("mensajes")
      .delete()
      .eq("id", id)
      .is("meta_message_id", null);
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
  }
```

Verificar que `ConflictError` esté importado en ese archivo; ya lo usa `create` (línea 68), así que debería estar.

- [ ] **Step 6: Correr los tests y verificar que pasan**

```bash
npx vitest run tests/unit/messages-supabase-repo.test.ts tests/repositories
```

Esperado: PASS, incluidos los cuatro tests nuevos.

- [ ] **Step 7: Correr la suite completa y el typecheck**

```bash
npm test
```

```bash
npm run typecheck
```

Esperado: 1599 tests pasan (los 1595 del baseline más los 4 nuevos), 0 errores de tipos.

- [ ] **Step 8: Commit**

```bash
git add src/server/repositories/messages.repo.ts src/server/repositories/messages.supabase.repo.ts tests/repositories/messages.contract.ts
git commit -m "feat(mensajes): reservar, confirmar y liberar salientes"
```

---

### Task 3: `sendOutbound` reserva antes de llamar a Meta

**Files:**

- Modify: `src/server/services/meta-api.service.ts:94-123` (método `sendOutbound`)
- Test: `tests/unit/meta-api-idempotency.test.ts`

**Interfaces:**

- Consume: `MessagesRepository.confirmarEnvio(id, metaMessageId)`, `.marcarFalloEnvio(id, error)`, `.liberarReserva(id)` de la Tarea 2.
- Produce: `sendOutbound(input: SendOutboundInput): Promise<Mensaje>` con la misma firma pública de hoy. Ningún llamador cambia.

**La regla de decisión, que es lo único sutil de esta tarea:**

| Error que tira el cliente Meta                         | ¿Meta pudo haber recibido el mensaje? | Qué hace la reserva | Qué pasa en el reintento                         |
| ------------------------------------------------------ | ------------------------------------- | ------------------- | ------------------------------------------------ |
| `ValidationError` (400 / 401 / 403 / respuesta sin id) | No: rechazo explícito                 | `marcarFalloEnvio`  | `isNonRetriable` → Inngest no reintenta          |
| `RateLimitError` (429)                                 | No: rechazo explícito                 | `liberarReserva`    | Reintenta y **reenvía**, que es lo correcto      |
| `InfraError` (5xx, red) o cualquier otro               | **Sí, posiblemente**                  | `marcarFalloEnvio`  | Reintenta, encuentra la reserva y **no reenvía** |

`isNonRetriable` (`src/lib/errors.ts:120`) hoy incluye `ValidationError` y no incluye `RateLimitError` ni `InfraError`, así que esta tabla es consistente con el comportamiento de reintentos que ya existe. No hay que tocar `isNonRetriable`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/unit/meta-api-idempotency.test.ts`. Estos tests son el corazón del arreglo: cada uno describe una forma concreta en que hoy el cliente recibiría un mensaje de más o de menos.

```typescript
describe("sendOutbound — ventana de doble envio", () => {
  test("si la escritura falla despues de Meta, el reintento NO reenvia", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550000",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);
    const entrada = {
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa" as const,
      to: "5491155550000",
      contenido: "tenemos el filtro",
      sender: "ia" as const,
      idempotencyKey: "out:wamid.ENTRANTE",
    };

    // Primer intento: Meta acepta, pero confirmar la fila falla.
    const confirmar = vi
      .spyOn(messages, "confirmarEnvio")
      .mockRejectedValueOnce(new InfraError("postgrest caido", "postgrest"));
    await expect(service.sendOutbound(entrada)).rejects.toThrow(InfraError);
    expect(client.calls).toHaveLength(1);

    // Reintento de Inngest: encuentra la reserva y no vuelve a llamar a Meta.
    confirmar.mockRestore();
    await service.sendOutbound(entrada);
    expect(client.calls).toHaveLength(1);
  });

  test("un 5xx de Meta deja la reserva visible como fallida y no reenvia", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    client.failWith = new InfraError("Meta 503", "meta");
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550001",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);
    const entrada = {
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa" as const,
      to: "5491155550001",
      contenido: "hola",
      sender: "ia" as const,
      idempotencyKey: "out:wamid.CINCOXX",
    };

    await expect(service.sendOutbound(entrada)).rejects.toThrow(InfraError);

    const reserva = await messages.findByIdempotencyKey("out:wamid.CINCOXX");
    expect(reserva?.meta_message_id).toBeNull();
    expect(reserva?.estado_entrega).toBe("fallido");
    expect(reserva?.error_entrega).toContain("Meta 503");

    client.failWith = null;
    await service.sendOutbound(entrada);
    expect(client.calls).toHaveLength(1);
  });

  test("un 429 libera la reserva y el reintento si reenvia", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    client.failWith = new RateLimitError("Meta rate-limited", "meta");
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550002",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);
    const entrada = {
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa" as const,
      to: "5491155550002",
      contenido: "hola",
      sender: "ia" as const,
      idempotencyKey: "out:wamid.CUATRO29",
    };

    await expect(service.sendOutbound(entrada)).rejects.toThrow(RateLimitError);
    expect(await messages.findByIdempotencyKey("out:wamid.CUATRO29")).toBeNull();

    client.failWith = null;
    const enviado = await service.sendOutbound(entrada);
    expect(client.calls).toHaveLength(2);
    expect(enviado.meta_message_id).not.toBeNull();
  });

  test("el camino feliz persiste el meta_message_id que devolvio Meta", async () => {
    const conversations = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    const client = new FakeMetaApiClient();
    const conv = await conversations.create({
      lead_id: crypto.randomUUID(),
      canal: "wa",
      canal_thread_id: "5491155550003",
    });
    const service = new DefaultMetaApiService(conversations, messages, client);

    const enviado = await service.sendOutbound({
      conversacionId: conv.id,
      leadSessionId: crypto.randomUUID(),
      canal: "wa",
      to: "5491155550003",
      contenido: "hola",
      sender: "ia",
      idempotencyKey: "out:wamid.FELIZ",
    });

    // `FakeMetaApiClient` numera sus ids desde 1 con el prefijo `wamid.fake-`.
    expect(enviado.meta_message_id).toBe("wamid.fake-1");
    expect(enviado.estado_entrega).toBeNull();
    expect(client.calls[0]?.text).toBe("hola");
    expect(await messages.findByMetaMessageId("wamid.fake-1")).not.toBeNull();
  });
});
```

Imports que hay que tener en la cabecera del archivo de test:

```typescript
import { describe, expect, test, vi } from "vitest";
import { InfraError, RateLimitError } from "@/lib/errors";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { FakeMetaApiClient } from "../mocks/meta";
```

- [ ] **Step 2: Que `FakeMetaApiClient` pueda fallar**

Los tests de arriba necesitan `client.failWith`, que el fake todavía no tiene. **No cambiar la forma de `calls`**: hoy es `MetaSendTextInput[]` y los tests existentes leen `calls[i].text` (por ejemplo `tests/unit/handoff-notification.test.ts:66`). Un solo campo nuevo alcanza.

En `tests/mocks/meta.ts`, dentro de la clase:

```typescript
  /** Si está seteado, `sendText` rechaza con este error en vez de responder. */
  failWith: Error | null = null;
```

y como primera línea de `sendText`, antes del `this.calls.push(input)`:

```typescript
if (this.failWith) throw this.failWith;
```

El rechazo va **antes** de registrar la llamada a propósito: un envío que falló no es un envío hecho, y los tests cuentan `calls.length` para detectar reenvíos.

- [ ] **Step 3: Correr los tests y verificar que fallan**

```bash
npx vitest run tests/unit/meta-api-idempotency.test.ts -t "ventana de doble envio"
```

Esperado: FAIL. Los dos primeros fallan con `expect(client.calls).toHaveLength(1)` recibiendo `2` — que es exactamente el defecto: hoy se reenvía.

- [ ] **Step 4: Reescribir `sendOutbound`**

Reemplazar el cuerpo completo del método en `src/server/services/meta-api.service.ts:94-123`:

```typescript
  async sendOutbound(input: SendOutboundInput): Promise<Mensaje> {
    // Una reserva sin `meta_message_id` significa "ya se intentó, desenlace
    // desconocido". No se reenvía: un WhatsApp duplicado no se puede retirar,
    // y esta fila sí se ve en el hilo marcada como fallida.
    if (input.idempotencyKey) {
      const existing = await this.messages.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    // La fila se escribe ANTES de llamar a Meta. Si se escribiera después, un
    // fallo de esa escritura dejaría al reintento sin rastro del envío y el
    // cliente recibiría el mensaje dos veces.
    const reserva = await this.messages.create({
      conversacion_id: input.conversacionId,
      lead_session_id: input.leadSessionId,
      direction: "out",
      sender: input.sender,
      sender_user_id: input.senderUserId ?? null,
      tipo: "text",
      contenido: input.contenido,
      media_url: null,
      meta_message_id: null,
      idempotency_key: input.idempotencyKey ?? null,
      metadata: metadataDelSaliente(input.plantilla),
      platform_created_at: null,
    });

    let result: MetaSendResult;
    try {
      result = await this.client.sendText({
        canal: input.canal,
        to: input.to,
        text: input.contenido,
      });
    } catch (error) {
      // 429: Meta rechazó explícitamente, no llegó nada. Se libera la clave
      // para que el reintento pueda volver a intentar de verdad.
      if (error instanceof RateLimitError) {
        await this.messages.liberarReserva(reserva.id);
        throw error;
      }
      // Todo lo demás queda visible en el hilo. Para ValidationError el envío
      // está descartado; para InfraError el desenlace es desconocido y esa
      // ambigüedad es justamente lo que la marca comunica.
      await this.messages.marcarFalloEnvio(reserva.id, mensajeDeError(error));
      throw error;
    }

    const msg = await this.messages.confirmarEnvio(reserva.id, result.meta_message_id);
    await this.conversations.touch(input.conversacionId);
    return msg;
  }
```

Agregar al final del archivo, junto a `metadataDelSaliente`:

```typescript
/** Texto del error para `error_entrega`. Nunca incluye el contenido del mensaje. */
function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

Y al bloque de imports de la línea 1:

```typescript
import { RateLimitError } from "@/lib/errors";
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
npx vitest run tests/unit/meta-api-idempotency.test.ts tests/unit/meta-api.test.ts tests/unit/handoff-notification.test.ts
```

Esperado: PASS, incluidos los cuatro nuevos.

- [ ] **Step 6: Correr la suite completa**

```bash
npm test
```

Esperado: PASS. Prestar atención a `tests/unit/on-message-received.test.ts` y `tests/smoke/`: si alguno asumía que `create` recibía el `meta_message_id` en el mismo insert, ahora ve una reserva y una confirmación. Si un test falla por eso, **el test está afirmando el orden viejo y hay que actualizarlo**, no revertir el arreglo.

- [ ] **Step 7: Typecheck y lint**

```bash
npm run typecheck
```

```bash
npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/server/services/meta-api.service.ts tests/unit/meta-api-idempotency.test.ts tests/mocks/meta.ts
git commit -m "fix(meta): reservar el saliente antes de llamar a Meta"
```

---

### Task 4: Los fallos de red del cliente Graph salen tipados

**Files:**

- Modify: `src/server/services/meta/graph-api-client.ts:101-108` (fetch de `sendWa`) y `:148-155` (fetch de `sendMessenger`)
- Test: `tests/unit/meta/graph-api-client.test.ts`

**Por qué:** `throwMappedGraphError` mapea prolijamente los códigos HTTP, pero si `fetch` **rechaza** —DNS caído, conexión rechazada, timeout de undici— ese `TypeError` crudo escapa del cliente sin pasar por la taxonomía. Viola `AGENTS.md §0.10` y, ahora que la Tarea 3 decide qué hacer según el tipo del error, un error sin tipar cae en la rama "desenlace desconocido". Para una conexión rechazada eso es conservador de más: Meta nunca vio nada, se podría haber reenviado.

**Interfaces:**

- Consume: `InfraError` de `@/lib/errors`.
- Produce: garantía de que `GraphApiMetaClient.sendText` solo tira `ValidationError`, `RateLimitError` o `InfraError`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `tests/unit/meta/graph-api-client.test.ts`:

```typescript
test("un fallo de red sale como InfraError y no como TypeError", async () => {
  const client = new GraphApiMetaClient({
    graphApiVersion: "v21.0",
    whatsappPhoneNumberId: "PNI",
    whatsappAccessToken: "token",
    fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
  });

  await expect(
    client.sendText({ canal: "wa", to: "5491155550000", text: "hola" }),
  ).rejects.toBeInstanceOf(InfraError);
});
```

Con `import { InfraError } from "@/lib/errors";` en la cabecera si no está.

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run tests/unit/meta/graph-api-client.test.ts -t "fallo de red"
```

Esperado: FAIL, recibiendo un `TypeError` donde esperaba `InfraError`.

- [ ] **Step 3: Envolver los dos fetch**

En `sendWa`, reemplazar la llamada de la línea 101:

```typescript
const res = await fetchOrInfra(
  this.fetchImpl,
  url,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${this.cfg.whatsappAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  },
  "wa.sendText",
);
```

En `sendMessenger`, la de la línea 148:

```typescript
const res = await fetchOrInfra(
  this.fetchImpl,
  url,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  },
  `${canal}.sendText`,
);
```

Y agregar el helper junto a `throwMappedGraphError`, al final del archivo:

```typescript
/**
 * `fetch` rechaza sin pasar por `throwMappedGraphError` cuando el fallo es de
 * red y no de protocolo. Sin esto, un `TypeError` crudo escapa del cliente y
 * el llamador no puede distinguir "Meta rechazó" de "no llegamos a Meta".
 */
async function fetchOrInfra(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (cause) {
    const detalle = cause instanceof Error ? cause.message : String(cause);
    throw new InfraError(`Meta ${operation} sin respuesta: ${detalle}`, "meta", cause);
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run tests/unit/meta/graph-api-client.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Suite completa y typecheck**

```bash
npm test
```

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/services/meta/graph-api-client.ts tests/unit/meta/graph-api-client.test.ts
git commit -m "fix(meta): fallos de red del cliente Graph salen como InfraError"
```

---

# FASE 2 — Seguridad del entorno de tests

### Task 5: Guarda que impide vaciar la base de la app

**Files:**

- Modify: `tests/integration/setup.ts:39-56` (`makeTestSupabaseClient`)
- Create: `tests/unit/integration-setup-guard.test.ts`

**Por qué:** `cleanupTestDb` borra 17 tablas, entre ellas `usuarios` y `empresas`. Hoy `SUPABASE_TEST_URL` y `NEXT_PUBLIC_SUPABASE_URL` apuntan al **mismo** proyecto Supabase — verificado el 2026-08-12 comparando los valores de `.env.local`. La única protección existente es prosa: un comentario en `setup.ts:11` y una viñeta en `AGENTS.md §6`. Ya vació la base de dev una vez.

Esta tarea **no** descongela la suite de integración —para eso hace falta el segundo proyecto Supabase, que lo tiene que crear el dueño (ver Fase 6)—. Lo que hace es garantizar que correrla por accidente no destruya nada.

**Interfaces:**

- Consume: nada.
- Produce: `assertBaseDeTestsAislada(testUrl: string | undefined, appUrl: string | undefined): void` exportada desde `tests/integration/setup.ts`, para poder testearla sin tocar la red.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/integration-setup-guard.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { assertBaseDeTestsAislada } from "../integration/setup";

describe("assertBaseDeTestsAislada", () => {
  test("rechaza cuando la base de tests es la misma que la de la app", () => {
    expect(() =>
      assertBaseDeTestsAislada("https://abc.supabase.co", "https://abc.supabase.co"),
    ).toThrow(/mismo proyecto Supabase/);
  });

  test("ignora diferencias de barra final y mayusculas", () => {
    expect(() =>
      assertBaseDeTestsAislada("https://ABC.supabase.co/", "https://abc.supabase.co"),
    ).toThrow(/mismo proyecto Supabase/);
  });

  test("acepta cuando son proyectos distintos", () => {
    expect(() =>
      assertBaseDeTestsAislada("https://tests.supabase.co", "https://app.supabase.co"),
    ).not.toThrow();
  });

  test("acepta cuando la url de la app no esta definida", () => {
    expect(() => assertBaseDeTestsAislada("https://tests.supabase.co", undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run tests/unit/integration-setup-guard.test.ts
```

Esperado: FAIL con `assertBaseDeTestsAislada is not a function` (o error de importación).

- [ ] **Step 3: Implementar la guarda**

En `tests/integration/setup.ts`, agregar antes de `makeTestSupabaseClient`:

```typescript
function normalizarUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Corta la ejecución si los tests de integración apuntan al mismo proyecto
 * Supabase que la aplicación.
 *
 * `cleanupTestDb` borra 17 tablas, incluidas `usuarios` y `empresas`. Correr
 * la suite contra la base de la app la vacía — ya pasó una vez. La protección
 * anterior era un comentario, y un comentario no detiene un comando.
 */
export function assertBaseDeTestsAislada(
  testUrl: string | undefined,
  appUrl: string | undefined,
): void {
  if (!testUrl || !appUrl) return;
  if (normalizarUrl(testUrl) !== normalizarUrl(appUrl)) return;
  throw new Error(
    "SUPABASE_TEST_URL apunta al mismo proyecto Supabase que NEXT_PUBLIC_SUPABASE_URL. " +
      "cleanupTestDb vaciaria la base de la aplicacion. " +
      "Crear un proyecto Supabase exclusivo para tests y apuntar ahi " +
      "SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY.",
  );
}
```

Y llamarla dentro de `makeTestSupabaseClient`, inmediatamente después de la validación de env que ya existe:

```typescript
assertBaseDeTestsAislada(url, process.env["NEXT_PUBLIC_SUPABASE_URL"]);
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx vitest run tests/unit/integration-setup-guard.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Step 5: Verificar que la guarda dispara de verdad**

Este paso es el que prueba que la guarda sirve. `vitest.integration.config.ts` no inyecta `NEXT_PUBLIC_SUPABASE_URL` al entorno de los tests salvo a través de `loadEnv`, así que hay que agregarlo a la lista `env` del config para que la guarda pueda verlo:

```typescript
        NEXT_PUBLIC_SUPABASE_URL: env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
```

Después, correr **un solo archivo** de integración que llame a `makeTestSupabaseClient` y confirmar que aborta antes de tocar la red:

```bash
npx vitest run -c vitest.integration.config.ts tests/integration/leads.supabase.test.ts
```

Esperado: FAIL en el setup con el mensaje `SUPABASE_TEST_URL apunta al mismo proyecto Supabase...`. **Ninguna fila borrada.** Si en cambio la suite arranca y empieza a borrar, cortar de inmediato: la guarda no quedó bien cableada.

- [ ] **Step 6: Suite unitaria completa y typecheck**

```bash
npm test
```

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add tests/integration/setup.ts tests/unit/integration-setup-guard.test.ts vitest.integration.config.ts
git commit -m "test: cortar la integracion si apunta a la base de la app"
```

---

# FASE 3 — Deuda de correctitud menor

### Task 6: `server_now()` con `search_path` fijo

**Files:**

- Create: `supabase/migrations/20260813090000_server_now_search_path.sql`

**Por qué:** el advisor de seguridad de Supabase reporta `function_search_path_mutable` sobre `public.server_now`. La migración `20260512000015` arregló esto para cuatro helpers, pero `server_now` se creó después (`20260514000016`) y nunca recibió el mismo tratamiento. Una función sin `search_path` fijo puede resolver nombres contra un esquema que controle el llamador.

**Interfaces:**

- Consume: la función `public.server_now()` creada en `20260514000016_repo_helpers.sql`.
- Produce: la misma función, con `search_path` explícito. Ningún cambio de firma; nada en TypeScript cambia.

- [ ] **Step 1: Leer cómo está definida hoy**

```bash
cat supabase/migrations/20260514000016_repo_helpers.sql
```

Anotar la firma exacta, el `returns` y si es `security definer` o `invoker`. La migración nueva tiene que repetirlos idénticos: un `create or replace` que cambie el tipo de retorno falla.

- [ ] **Step 2: Escribir la migración**

Crear `supabase/migrations/20260813090000_server_now_search_path.sql`. Ajustar el cuerpo y el `returns` a lo que se leyó en el paso 1 si difiere:

```sql
-- Fija el search_path de server_now(), que quedó fuera de la migración
-- 20260512000015 por haberse creado después (20260514000016).
-- Advisor: function_search_path_mutable (WARN).
-- Ver https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;

-- El grant a anon lo puso 20260714182011 para /api/health; create or replace
-- conserva los privilegios existentes, pero se repite para que esta migración
-- sea legible por sí sola.
grant execute on function public.server_now() to anon;
```

- [ ] **Step 3: Aplicar a `crm-dev`**

Es una migración aditiva sobre una función existente, sin reset ni truncate — permitida por la decisión 4 de `docs/implementation-qa-2026-08-12.md`.

```bash
npm run db:push
```

- [ ] **Step 4: Verificar que quedaron 36 migraciones y que el advisor calló**

```bash
supabase migration list --linked
```

Esperado: 36/36, la última `20260813090000`.

Después consultar los advisors de seguridad del proyecto `emubzkouwvuzlrtsgorx` y confirmar que `function_search_path_mutable` sobre `public.server_now` ya no aparece. Los otros cuatro hallazgos (pg_trgm en `public`, protección de contraseñas filtradas, y los dos INFO de RLS sin policy) siguen abiertos a propósito — están en el registro de situaciones al final de este plan.

- [ ] **Step 5: Verificar que la app sigue leyendo la hora del server**

`serverNowIso(db)` es el helper que usa esta función (`src/server/db/server-time.ts`).

```bash
npx vitest run tests/unit -t "server"
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260813090000_server_now_search_path.sql
git commit -m "fix(db): fijar search_path de server_now"
```

---

### Task 7: `approveMerge` dentro del lock de sesión

**Files:**

- Modify: `src/server/services/leads/merge-executor.service.ts:31-38` (deps) y `:80-157` (`approveMerge`)
- Test: `tests/unit/services/merge-executor.test.ts`

**Por qué:** `approveMerge` valida en las líneas 110-118 que no haya dos sesiones activas y después escribe. Entre el chequeo y `reassignLead` puede entrar un mensaje del lead y crearse una sesión activa nueva; el resultado es un lead con dos sesiones activas, que es justo lo que el índice UNIQUE parcial `(lead_id) WHERE resultado IS NULL` existe para prohibir — y el insert que lo viole va a explotar en producción, no acá. `SessionLock` ya existe en el proyecto (`src/server/lock/session-lock.ts`) y no se usa en este camino.

**Interfaces:**

- Consume: `SessionLock` de `@/server/lock/session-lock`, con `withLock<T>(key: string, fn: () => Promise<T>): Promise<T>`.
- Produce: `DefaultMergeExecutorServiceDeps` gana un campo `lock: SessionLock`. Quien construye el service —`src/server/bootstrap/leads-bootstrap.ts`— tiene que pasarlo.

- [ ] **Step 1: Confirmar la firma real de `SessionLock`**

```bash
cat src/server/lock/session-lock.ts
```

Anotar el nombre exacto del método y de la implementación in-memory. Si el método no se llama `withLock`, usar el nombre real en todos los pasos siguientes de esta tarea.

- [ ] **Step 2: Escribir el test que falla**

Agregar a `tests/unit/services/merge-executor.test.ts`, dentro del `describe("DefaultMergeExecutorService.approveMerge", ...)`. El archivo ya tiene un `beforeEach` que arma `leads`, `sessions`, `convs`, `tags`, `candidates`, `auditRepo` y `svc` (líneas 63-78), y un helper `seedPair()` (línea 80) que crea el par de leads y el candidate pendiente. El test usa ese andamiaje y construye su propio service solo para inyectar un lock espía:

```typescript
test("approveMerge corre dentro del lock del par de leads", async () => {
  const { ganador, perdedor, cand } = await seedPair();
  const clavesTomadas: string[] = [];
  const lockEspia = {
    withLock: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      clavesTomadas.push(key);
      return fn();
    },
  };
  const conLock = new DefaultMergeExecutorService({
    leads,
    sessions,
    convs,
    tags,
    candidates,
    audit: new DefaultAdminAuditService(auditRepo),
    lock: lockEspia,
  });

  await conLock.approveMerge({
    candidateId: cand.id,
    keepLeadId: ganador.id,
    actorUserId: null,
  });

  expect(clavesTomadas).toEqual([`merge:${[ganador.id, perdedor.id].sort().join(":")}`]);
  expect(await leads.findById(perdedor.id)).toBeNull();
});
```

El último assert está a propósito: sin él, el test pasaría igual si el lock se tomara y el merge no se ejecutara adentro.

- [ ] **Step 3: Correr el test y verificar que falla**

```bash
npx vitest run tests/unit/services/merge-executor.test.ts -t "lock"
```

Esperado: FAIL — `clavesTomadas` queda vacío porque hoy nadie toma el lock.

- [ ] **Step 4: Agregar el lock a las deps**

En `src/server/services/leads/merge-executor.service.ts`, agregar al import:

```typescript
import type { SessionLock } from "@/server/lock/session-lock";
```

y al interface de deps:

```typescript
/**
 * Serializa el merge por par de leads. Sin esto, entre la validación de
 * "no hay dos sesiones activas" y `reassignLead` puede entrar un mensaje y
 * crear una sesión activa nueva, dejando al ganador con dos.
 */
lock: SessionLock;
```

- [ ] **Step 5: Envolver el cuerpo de `approveMerge`**

Renombrar el método actual a `ejecutarMerge` (privado, mismo cuerpo, sin tocar una línea de su lógica) y crear el público que lo envuelve. La clave se arma ordenando los dos ids para que el par `(A,B)` y el par `(B,A)` tomen el mismo lock:

```typescript
  async approveMerge(input: ApproveMergeInput): Promise<{ ganadorId: UUID }> {
    const candidate = await this.deps.candidates.findById(input.candidateId);
    if (!candidate) {
      throw new NotFoundError(
        `merge_candidate no encontrado: ${input.candidateId}`,
        "merge_candidate",
        input.candidateId,
      );
    }
    const clave = `merge:${[candidate.src_lead_id, candidate.dst_lead_id].sort().join(":")}`;
    return this.deps.lock.withLock(clave, () => this.ejecutarMerge(input));
  }

  private async ejecutarMerge(input: ApproveMergeInput): Promise<{ ganadorId: UUID }> {
    // ... cuerpo actual del método, sin cambios ...
  }
```

El `findById` queda duplicado (una vez para armar la clave, otra dentro de `ejecutarMerge`). Es intencional: la validación de "candidate ya resuelto" tiene que correr **dentro** del lock, no antes.

- [ ] **Step 6: Pasar el lock en todas las construcciones**

`lock` es obligatorio, así que toda construcción existente deja de compilar. Son dos lugares y los dos hay que tocarlos:

```bash
grep -rn "new DefaultMergeExecutorService" src tests
```

1. **El bootstrap** (`src/server/bootstrap/leads-bootstrap.ts`): agregar `lock` con la misma implementación de `SessionLock` que ya usan los otros consumidores del proyecto. Encontrarla con:

```bash
grep -rn "SessionLock" src/server/bootstrap/ src/inngest/
```

2. **El `beforeEach` del test** (`tests/unit/services/merge-executor.test.ts:71-78`): agregarle `lock` con un pasa-manos que no serialice nada, para que los tests que ya existían sigan corriendo igual:

```typescript
      lock: { withLock: async <T>(_key: string, fn: () => Promise<T>) => fn() },
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

```bash
npx vitest run tests/unit/services/merge-executor.test.ts
```

Esperado: PASS, incluidos los tests de merge que ya existían. Si alguno rompe porque construye el service sin `lock`, agregárselo.

- [ ] **Step 8: Suite completa, typecheck y lint**

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

- [ ] **Step 9: Commit**

```bash
git add src/server/services/leads/merge-executor.service.ts src/server/bootstrap/leads-bootstrap.ts tests/unit/services/merge-executor.test.ts
git commit -m "fix(leads): serializar el merge con el lock de sesion"
```

---

### Task 8: Borrar `CloseSessionButton`

**Files:**

- Delete: `src/components/inbox/CloseSessionButton.tsx`

**Por qué:** la decisión 1 de `docs/implementation-qa-2026-08-12.md` dice que queda una sola puerta de cierre, la del rail del Twin, y se elimina la del header. Se desconectó pero el archivo quedó. Es la lección 7 de `AGENTS.md` al revés: un componente sin consumidores no está hecho, y uno que sobrevive a su decisión de borrado es una trampa para el próximo que lo encuentre y crea que se usa.

**Interfaces:**

- Consume: nada.
- Produce: nada. Es una eliminación pura.

- [ ] **Step 1: Confirmar que no lo importa nadie**

```bash
grep -rn "CloseSessionButton" src tests
```

Esperado: **solo** líneas dentro de `src/components/inbox/CloseSessionButton.tsx` (su propia definición). Si aparece cualquier import en otro archivo, **parar**: la decisión de borrado no está completa y hay que resolver ese consumidor primero, no borrar a ciegas.

- [ ] **Step 2: Borrar el archivo**

```bash
git rm src/components/inbox/CloseSessionButton.tsx
```

- [ ] **Step 3: Verificar que nada se rompió**

```bash
npm run typecheck
```

```bash
npm test
```

Esperado: 0 errores de tipos, suite en verde. Si un test lo importaba, el paso 1 lo habría mostrado.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(inbox): borrar el boton de cierre del header"
```

---

# FASE 4 — Documentación de referencia

> Última fase ejecutable por un agente. Las tres que siguen dependen del dueño y son checklists, no tareas TDD.

> **Contexto:** `README.md`, `docs/next-session.md` y `docs/implementation-qa-2026-08-12.md` están al día y son honestos. El problema son los tres docs de referencia técnica, que son justo los que un agente nuevo lee para entender el sistema y contra los que va a razonar mal.

### Task 9: Reconstruir `docs/workflows.md` desde el código

**Files:**

- Modify: `docs/workflows.md`

**Qué está mal hoy, medido:**

| Línea   | Dice                    | Es                                                                                                                        |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 3       | "6 functions definidas" | 12                                                                                                                        |
| 29      | "consolida las 6"       | 12                                                                                                                        |
| 40+     | secciones numeradas     | orden 1,2,3,4,5,**7,8,6**                                                                                                 |
| 196-211 | bloque `CrmInngestDeps` | le faltan 8 deps que existen                                                                                              |
| —       | —                       | `on-status-received`, `recordatorio-seguimiento` y `handoff-notification` no están documentadas                           |
| —       | —                       | el catálogo de eventos no tiene `lead-session/recordatorio.cancelado` ni el de status ni el de la notificación de handoff |

**Interfaces:**

- Consume: `src/inngest/functions/index.ts`, `src/inngest/events.ts` y los 11 archivos de función.
- Produce: nada que consuma otra tarea.

- [ ] **Step 1: Sacar la lista real de funciones y de deps**

```bash
ls src/inngest/functions/
```

```bash
sed -n '28,60p' src/inngest/functions/index.ts
```

El `describe` del smoke test confirma el total: `tests/smoke/inbound-recv-loop.smoke.test.ts:55` afirma `toHaveLength(12)`.

- [ ] **Step 2: Sacar el catálogo real de eventos**

```bash
grep -n "eventType(" src/inngest/events.ts
```

- [ ] **Step 3: Corregir el encabezado y la numeración**

Reemplazar la línea 3 por el conteo real y renumerar las secciones de `## Functions` en orden corrido 1..11 (las dos de merge-candidates comparten sección, como ya está). No inventar: cada sección tiene que describir el archivo que existe.

- [ ] **Step 4: Documentar las tres funciones ausentes**

Agregar una sección por cada una, con el mismo formato de las existentes (Trigger + Acción). Los datos salen de leer el archivo:

- `on-status-received` — trigger y acción desde `src/inngest/functions/on-status-received.ts`.
- `recordatorio-seguimiento` — desde `src/inngest/functions/recordatorio-seguimiento.ts`. Documentar el `cancelOn` sobre `lead-session/recordatorio.cancelado` comparando id **y** fecha anterior, y que la comparación de fecha en Postgres queda como segunda barrera.
- `handoff-notification` — desde `src/inngest/functions/handoff-notification.ts`. Documentar la clave de idempotencia `handoff-notice:<handoffEventId>` y los tres motivos de no-envío (`session_missing`, `session_resumed`, `conversation_missing`).

- [ ] **Step 5: Rehacer el bloque `CrmInngestDeps`**

Copiar la forma real desde `src/inngest/functions/index.ts` (el `export interface CrmInngestDeps`), no la de 2026-05.

- [ ] **Step 6: Sacar la afirmación de Log Drains**

La línea 218 dice que `logger` es `PinoLogger con Vercel Log Drains`. No hay deploy en Vercel. Reemplazar por lo que es: `PinoLogger` en producción, `ConsoleLogger` en desarrollo, seleccionado por `getLogger(env)`; los Log Drains quedan pendientes del deploy.

- [ ] **Step 7: Verificar el formato**

```bash
npm run format:check
```

Si falla:

```bash
npm run format
```

- [ ] **Step 8: Commit**

```bash
git add docs/workflows.md
git commit -m "docs(workflows): 12 funciones reales y deps al dia"
```

---

### Task 10: Reconstruir la tabla de migraciones de `docs/data-model.md`

**Files:**

- Modify: `docs/data-model.md`

**Qué está mal hoy:** el doc se presenta como "Espejo del modelo versionado en `supabase/migrations/`" y su tabla llega hasta la migración 15 de 35 (36 después de la Tarea 6). Faltan las 43 policies RLS de Slice 3, `agente_config`, y las 14 del checkpoint QA.

**Interfaces:**

- Consume: `supabase/migrations/`.
- Produce: nada que consuma otra tarea.

- [ ] **Step 1: Sacar la lista real y ordenada**

```bash
ls supabase/migrations/
```

- [ ] **Step 2: Verificar que la lista local coincide con lo aplicado**

```bash
supabase migration list --linked
```

Esperado: mismo conteo y mismos timestamps en ambas columnas. Si divergen, **parar y reportarlo**: significa que hay una migración aplicada que el repo no tiene, o al revés, y eso se resuelve antes de documentar nada.

- [ ] **Step 3: Completar la tabla**

Extender la tabla existente desde la fila 16 hasta el final, con una fila por migración. El contenido de cada una sale de leer su encabezado — no adivinar por el nombre del archivo. Las 20 filas nuevas van del `20260714124024_slice3_rls_policies` al `20260813090000_server_now_search_path`.

- [ ] **Step 4: Sacar la nota que ya no aplica**

El bloque de la línea 5 dice "Los cambios QA autorizados pero todavía no verificados están separados en `docs/implementation-qa-2026-08-12.md`". Esas migraciones ya están aplicadas y ahora figuran en la tabla; reescribir la nota para que apunte al estado real en vez de a una separación que dejó de existir.

- [ ] **Step 5: Formato**

```bash
npm run format:check
```

- [ ] **Step 6: Commit**

```bash
git add docs/data-model.md
git commit -m "docs(data-model): tabla de migraciones completa"
```

---

### Task 11: Saldar el hueco del changelog y las contradicciones

**Files:**

- Modify: `docs/changelog.md`
- Modify: `docs/idempotency.md:42` y `:66`
- Modify: `AGENTS.md` (§0.10 y §2)
- Modify: `README.md:27`

**Interfaces:**

- Consume: el trabajo de las Tareas 1 a 10.
- Produce: nada.

- [ ] **Step 1: Llenar el hueco de mayo→agosto en el changelog**

`docs/changelog.md` salta del `## Checkpoint QA — 2026-08-12` directo a `## Slice 1 sub-paso 7.4 follow-up — 2026-05-14`. Faltan, en orden cronológico inverso: el rediseño A-G2, Slice 4b (cadena WhatsApp E2E real), Slice 4a (hardening), fase 10 Leads, Slice 3 (auth + RLS), y las fases 9, 11 y 12 de Slice 2.

El material ya está escrito y verificado en `AGENTS.md §2` ("Estado actual" y "Acción previa"), que es la fuente. Mover ese contenido al changelog con una sección por hito y fecha. No reescribir la historia ni suavizarla: los pendientes declarados en cada hito se conservan.

- [ ] **Step 2: Resolver la contradicción de la concurrency key**

`docs/idempotency.md:66` dice `TODO Fase 7: considerar Inngest concurrency key per meta_user_id`. `docs/workflows.md:46` dice que está implementado (B4, `key: "event.data.parsed.meta_user_id"`, `limit: 1`). Verificar cuál es cierto:

```bash
grep -n "concurrency" src/inngest/functions/on-message-received.ts
```

Corregir el doc que esté equivocado según lo que devuelva ese grep.

- [ ] **Step 3: Actualizar la nota de doble envío**

`docs/idempotency.md:42` describe la ventana de doble envío como "Mitigación pending Fase 7 … Investigar". La Tarea 3 la cerró. Reescribir esa sección con lo que hace hoy `sendOutbound`: reserva → envío → confirmación, y la tabla de decisión por tipo de error (`ValidationError` marca fallido y no reintenta · `RateLimitError` libera y reenvía · `InfraError` marca fallido y no reenvía). Dejar explícito el intercambio: no hay exactly-once contra una API remota; se eligió una fila visible sin confirmar por sobre un mensaje duplicado irretractable.

- [ ] **Step 4: Corregir `AGENTS.md §0.10`**

Dice que `InfraError`/`RateLimitError` "NO existen aún — backlog Slice 4b" y que `mapPostgrestError` en su rama default lanza `Error` plano. Las dos clases están en `src/lib/errors.ts:90` y `:103`, y el default del mapper devuelve `InfraError`. Sacar la deuda y dejar la regla.

- [ ] **Step 5: Corregir el estado de Realtime en `AGENTS.md §2`**

La tabla de progreso dice "Slice 2 — UI + Realtime + Server Actions 🟢 completo". Realtime no existe: `grep -rn "\.channel(\|postgres_changes" src` da cero. Lo que hay es `RefreshPoller intervalMs={5000}` en `src/app/(panel)/inbox/layout.tsx:33`, que hace `router.refresh()` del árbol RSC completo cada 5 segundos. Corregir la fila para que diga qué está hecho y qué no.

- [ ] **Step 6: Unificar las cifras del piloto**

`README.md:27` dice "~1000 leads/semana. Equipo: 3-4 usuarios internos". `AGENTS.md §1` dice "30 vendedores, peak 50 msg/sec, ~5K leads/mes". Preguntar al dueño cuál es la cifra buena y dejar **una sola** en los dos archivos. Si no hay respuesta, dejar las dos con una nota que diga cuál corresponde a qué (piloto inicial vs. tier objetivo) en vez de que se contradigan en silencio.

- [ ] **Step 7: Actualizar el estado y la última acción de `AGENTS.md §2`**

Escribir qué hizo este plan y qué sigue sin verificarse. Regla de la casa: lo no verificado se nombra como no verificado.

- [ ] **Step 8: Verificación final completa**

```bash
npm run ci
```

Esperado: typecheck, lint, format:check y coverage, todo en verde, con la cobertura por encima de 80/75/80/80.

- [ ] **Step 9: Commit y push**

```bash
git add docs/changelog.md docs/idempotency.md AGENTS.md README.md
git commit -m "docs: saldar el hueco del changelog y las contradicciones"
```

```bash
git push origin master
```

---

# FASE 5 — Verificación contra la base real (requiere sesión del dueño)

> **No son tareas TDD.** Son checklists de verificación que necesitan una sesión autenticada, un dev server levantado por el dueño, y datos. Un agente puede ejecutarlas acompañado, no solo.

- [ ] **V1 — Smoke autenticado de `inbox_recent_messages`.** Llamarla con la sesión autenticada del admin (`admin-dev@crm.local`), no con service role. La RPC es `security invoker`: lo que hay que probar es justamente que las policies RLS la dejan pasar. Sin esto, la ruta `/inbox` está probada solo por el camino que ignora RLS.
- [ ] **V2 — Smoke autenticado de `transition_handoff`.** Igual que arriba. Verificar además que dos llamadas con el mismo evento no duplican filas en `handoff_events`. **No enviar mensajes reales por Meta.**
- [ ] **V3 — Regenerar los tipos de Supabase y revisar el diff.** `npm run db:gen-types`. Revisar el diff antes de conservarlo: si aparecen columnas que el código no conoce, hay una migración que nadie documentó.
- [ ] **V4 — `EXPLAIN (ANALYZE, BUFFERS)`** sobre `inbox_recent_messages` y sobre la búsqueda que usa el índice trigram. Con 3 mensajes en la base esto no prueba nada sobre escala: anotar el volumen real contra el que se midió y **no extrapolar**. Para que los números signifiquen algo hace falta `npm run build` con el dev server muerto y `.next` borrado.
- [ ] **V5 — Observar una ejecución real de `recordatorio-seguimiento`** en el dashboard local de Inngest (`http://localhost:8288`), incluida una reprogramación, para confirmar que el `cancelOn` no alcanza a la ejecución nueva.

# FASE 6 — Datos y entorno (requiere decisiones del dueño)

- [ ] **D1 — Cargar catálogo y empresa.** `productos`, `intents`, `reglas` y `empresas` están en **0** filas (medido el 2026-08-12 contra `crm-dev`). El agente llama `buscar_repuesto`, recibe cero resultados y responde "no lo tenemos". Siempre. Todo el motor de intents y reglas —el diferenciador de costo del producto— está construido y sin una sola fila. **Esto impide que el producto haga lo que promete** y no se resuelve con código.
- [ ] **D2 — Crear un segundo proyecto Supabase para tests.** Free tier alcanza. Apuntar ahí `SUPABASE_TEST_URL` y `SUPABASE_TEST_SERVICE_KEY`, aplicar las 36 migraciones, y recién entonces correr `npm run test:integration`. Sin esto, los contract tests de `turn-classifications`, `llm-usage`, `session-recordatorios`, `handoff-events` y los de `agente_config` posteriores a G1 **nunca tocaron Postgres real**: todo lo que sabemos de esos repos viene del in-memory, que no tiene FKs, ni `not null`, ni RLS. La Tarea 5 de este plan protege contra el borrado accidental, pero no descongela la suite.

# FASE 7 — QA visual (humana)

- [ ] **Q1 — `/leads`** con los filtros nuevos: es la pantalla que más cambió.
- [ ] **Q2 — `/metricas`**, tres cortes. Hacerlo **después** de D1: hoy `llm_usage` y `turn_classifications` están en 0 y varios cuadros no tienen de dónde leer, así que una revisión ahora no distingue "bug" de "sin datos".
- [ ] **Q3 — `/agente`**, sus cuatro pestañas, incluida la degradación del preview.
- [ ] **Q4 — `/tags`.**
- [ ] **Q5 — Buscador del Inbox** y flujo de reprogramar un seguimiento.
- [ ] **Q6 — Comparación contra el prototipo** `docs/handoff-rediseno-README.md`. Si una pantalla no coincide con ese archivo, el que está mal es el código.

Viewports: 1440×900, 1024×768, y el login en móvil. El dato duro de la historia del proyecto: **cada vez que el dueño mandó una captura aparecieron cosas que ninguna medición había detectado.** Un test que pregunta "¿el nodo existe y mide 322px?" contesta que sí de todas maneras.

---

# Situaciones que ocupan atención

Registro de lo que necesita decisión o vigilancia y **no** es una tarea de este plan. Está acá para que no se pierda, no para que se haga ahora.

### Riesgos de producto abiertos

| Situación                                                                                                                                                                                                                        | Impacto                                                                                                                                                                                                                                | Estado                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Sin tope de gasto de LLM.** Upstash sin configurar por decisión del dueño. `UpstashCostTracker` cae al `InMemoryCostTracker`, que en serverless no persiste entre cold starts — el warning sale en cada arranque de los tests. | El costo por lead y conversación **sí** se ve (vive en `llm_usage`, no en Upstash). Lo que no existe es el **corte**: un bucle descontrolado —un webhook que reintenta, una sesión que no cierra— factura sin límite y nadie lo frena. | Decisión tomada por el dueño. No insistir. Queda registrado.           |
| **Free tier de Supabase se auto-pausa** tras ~1 semana idle: el DNS deja de resolver y `/api/health` da `db: fail`.                                                                                                              | El sistema se cae solo sin que nadie lo toque.                                                                                                                                                                                         | Se restaura desde el dashboard. Hay un `supabase-keepalive.yml` en CI. |
| **Túnel cloudflared efímero.** Al reiniciarlo cambia la URL y hay que reconfigurar el webhook en Meta.                                                                                                                           | El inbound se corta en silencio.                                                                                                                                                                                                       | Lo resuelve el deploy a Vercel.                                        |
| **Sentry sin DSN.** Cableado y env-gated (`sentry.server.config.ts`, `sentry.edge.config.ts`), sin cuenta.                                                                                                                       | Excepciones no capturadas no se reportan. Fallos silenciosos.                                                                                                                                                                          | Falta crear la cuenta.                                                 |
| **Sin deploy.** No hay `vercel.json` ni `vercel.ts`, y la CLI de Vercel no está instalada (`npm i -g vercel`).                                                                                                                   | Nada de lo construido es alcanzable fuera de la máquina del dueño.                                                                                                                                                                     | Slice 4b.                                                              |
| **Número real de WhatsApp.** El de prueba solo mensajea a 5 destinatarios verificados.                                                                                                                                           | No hay soft launch posible.                                                                                                                                                                                                            | Slice 4b.                                                              |

### Deuda técnica conocida, con dueño y sin fecha

| Situación                                                                                                                                                                                                                                                             | Dónde                                                            | Por qué importa                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`leads.list()` topea en 1000 filas.** `LIST_LIMIT = 1000`.                                                                                                                                                                                                          | `src/server/services/leads/default-leads.service.ts:23`          | Las listas de opciones de los filtros salen de esas mismas 1000 filas: un vehículo que solo aparece en el lead 1001 no es ofrecible como filtro, así que el usuario no puede llegar a él ni sabe que existe. A ~5K leads/mes se cruza el umbral el primer mes.                                                                                                   |
| **No se puede filtrar por más de una etiqueta.** `etiquetaId` es un UUID suelto, no un array.                                                                                                                                                                         | `leads.service.ts:16`, `busqueda.service.ts:18`                  | La UI ofrece una sola porque el service no sabe hacer más. Pasar a `etiquetaIds: UUID[]` toca service, schema Zod, el parser de URL en `src/lib/ui/filtros-leads.ts` y los dos componentes de filtros.                                                                                                                                                           |
| **El índice trigram no se verificó bajo volumen.**                                                                                                                                                                                                                    | `supabase/migrations/20260811160000_mensajes_contenido_trgm.sql` | Con 3 mensajes en la base no se sabe si el planner lo elige, ni cuánto cuesta el insert de cada mensaje con el índice puesto.                                                                                                                                                                                                                                    |
| **`RefreshPoller` cada 5 s hace `router.refresh()` del árbol RSC completo.**                                                                                                                                                                                          | `src/app/(panel)/inbox/layout.tsx:33`                            | Es el puente hasta Supabase Realtime, que no está implementado. Amplifica cualquier costo del read path del Inbox por 12 veces por minuto y por usuario.                                                                                                                                                                                                         |
| **El smoke suite no es E2E aunque se llame así.** Corre todo in-memory con `LLM_MODE=mock`, `FakeMetaApiClient` e Inngest mockeado, y tiene asserts tautológicos (`tests/smoke/inbound-recv-loop.smoke.test.ts:78-86` verifica que un spy recibió lo que se le pasó). | `tests/smoke/`                                                   | Sirve como guardia de wireup. **No** cuenta como cobertura end-to-end. Es la lección 3 de `AGENTS.md`: el mock que acepta cualquier schema escondió durante meses que `update-lead-twin` nunca completaba una ejecución. La única red contra eso es la suite de contrato contra OpenAI real, que solo corre bajo `test:integration` — o sea, congelada hasta D2. |
| **`/ajustes` sigue siendo un `PantallaPendiente`.**                                                                                                                                                                                                                   | `src/app/(panel)/ajustes/page.tsx`                               | Es la única de las 7 pantallas del panel sin construir, y el handoff de diseño nunca la diseñó: no hay contra qué compararla. Antes de construirla hay que definir qué va adentro.                                                                                                                                                                               |
| **Advisors de Supabase abiertos** tras la Tarea 6: `pg_trgm` instalado en el esquema `public`; protección de contraseñas filtradas desactivada en Auth; `event_outbox` y `reactivation_dispatches` con RLS activo y cero policies.                                    | dashboard Supabase → Advisors                                    | Los dos INFO de RLS probablemente sean intencionales (tablas de solo service-role), pero conviene dejarlo escrito en una migración en vez de que queden como hallazgo abierto. La protección de contraseñas se activa desde el dashboard, en un clic.                                                                                                            |

### Datos viejos sin arreglo posible

No son bugs. La información no se guardó y no se puede reconstruir. Documentarlos como límites de lectura, y que ninguna pantalla los presente como ceros.

- **`tool_executions.mensaje_id` en `null`** en todas las filas anteriores al fix. La auditoría por turno las ata por ventana temporal (`listBySessionEntre`) en vez de por id: funciona, y es una aproximación.
- **Salientes de fuera de horario previos sin la marca de plantilla.** Caen en `sin_medicion`, y eso es correcto: de esos efectivamente no se sabe.
- **Sesiones cerradas sin `motivo_perdida`.** Obligatorio desde el cierre nuevo; las viejas lo tienen en `null` y las métricas las agrupan bajo `sin_motivo`.

### Ideas sin decidir

No empezar sin que el dueño las pida. Son features, no deuda.

- **Notas internas** en la conversación, que el cliente no ve.
- **Respuestas rápidas** — el botón `bolt` del composer, que el handoff maqueta y hoy no hace nada.
- **Dónde vive el desglose de motivos de escalado** en Métricas. El contrato y los datos ya viajan; falta decidir la ubicación.

### El patrón de fondo

Los tres hallazgos nuevos de esta auditoría ya estaban escritos en los propios docs del proyecto: el doble envío en `docs/idempotency.md:42`, el riesgo de vaciar la base en un comentario de `tests/integration/setup.ts:11`, y el mock que oculta incompatibilidades en la lección 3 de `AGENTS.md`. Ninguno se descubrió leyendo código nuevo: se descubrieron leyendo notas que alguien dejó y nadie volvió a mirar.

El proyecto documenta bien sus problemas y después los pierde de vista, porque `workflows.md` y `data-model.md` dejaron de mantenerse y arrastran a los demás. Las Tareas 9 a 11 atacan el síntoma. La causa es que ningún paso del proceso obliga a releer una nota diferida. Vale la pena que la próxima nota con la forma "pendiente Fase N" nazca con una fecha de revisión o no nazca.

---

## Orden de ejecución recomendado

1. **Task 1** — salvar el trabajo. Nada más importa si se pierden las dos migraciones untracked.
2. **Tasks 2, 3, 4** — la ventana de doble envío. Es el único defecto que hoy daña a un cliente real.
3. **Task 5** — la guarda de la base. Barata y desarma la bomba de forma permanente.
4. **Tasks 6, 7, 8** — deuda menor. Independientes entre sí, se pueden repartir.
5. **Tasks 9, 10, 11** — docs. Van al final para que reflejen todo lo anterior.
6. **Fases 5, 6 y 7** — con el dueño, en ese orden: primero datos (D1), después verificación (V1-V5), después QA visual (Q1-Q6). Revisar `/metricas` antes de cargar datos es mirar cuadros vacíos.
