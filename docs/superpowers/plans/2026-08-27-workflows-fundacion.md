# Workflows — Fundación (catálogo cerrado + paso de delegación a IA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Podar el catálogo de 57+5 tipos de nodo del canvas descartado a los ~13 tipos reales que sostienen el catálogo cerrado de 10 pasos + 8 triggers del spec, y construir el paso nuevo "Delegar al agente IA" — la pieza central del eje 2 (IA como ciudadana de primera clase).

**Architecture:** El motor de ejecución (`src/lib/workflows/engine/`) y el modelo `Grafo`/`Nodo`/`Arista` (`src/types/workflows.ts`) ya existen y no cambian de forma — solo se reduce QUÉ valores son válidos en `NodoTipo`, se podan los handlers a juego, y se agregan dos handlers nuevos (`ia_delegar`, `crm_escalar_humano`). No se toca ninguna UI en este plan — el canvas viejo sigue existiendo (con menos opciones en su paleta) hasta que el plan del Editor lo reemplace.

**Tech Stack:** TypeScript, Vitest. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-08-27-workflows-unificado-design.md` (secciones 2, 4 y 5 son las que este plan implementa).

## Global Constraints

- Catálogo cerrado: nada de HTTP genérico, código JS ejecutable, Sheets, DB externa (spec §4).
- El paso de delegación a IA nunca puede quedar sin un destino final definido — el timeout es obligatorio, no opcional (spec §5, corrección del self-review).
- TDD real: cada handler nuevo tiene su test escrito antes de la implementación, verificado en RED antes de escribir código (AGENTS.md §0.11).
- `npm run typecheck`, `npm run lint` y la suite completa de Vitest quedan en verde al final de cada task — no solo al final del plan.
- Español en identificadores de dominio, comentarios y commits; inglés en identificadores técnicos genéricos (AGENTS.md §4).

---

### Task 1: Catálogo cerrado en `types/workflows.ts`

**Files:**

- Modify: `src/types/workflows.ts`
- Test: `tests/unit/workflows/catalogo-tipos.test.ts` (nuevo)

**Interfaces:**

- Produces: `NODO_TIPOS_TRIGGER`, `NODO_TIPOS_MENSAJERIA`, `NODO_TIPOS_CRM`, `NODO_TIPOS_LOGICA`, `NODO_TIPOS_IA`, `NODO_TIPOS_INTERNO` (arrays podados), `esCondicion()` ampliado — todo lo que las Tasks 2-5 consumen.

- [ ] **Step 1: Escribir el test del catálogo (falla porque hoy el catálogo tiene 62 tipos, no los que este test espera)**

```typescript
import { describe, expect, it } from "vitest";
import { NODO_TIPOS, esCondicion } from "@/types/workflows";

describe("catálogo de tipos de nodo — cerrado al dominio (spec §4)", () => {
  it("no incluye ningún tipo de integración genérica", () => {
    const prohibidos = [
      "int_http",
      "int_webhook_out",
      "int_codigo",
      "int_email",
      "int_sheets",
      "int_db",
    ];
    for (const tipo of prohibidos) {
      expect(NODO_TIPOS).not.toContain(tipo);
    }
  });

  it("no incluye los tipos de IA viejos, reemplazados por ia_delegar", () => {
    const viejos = [
      "ia_clasificar",
      "ia_responder",
      "ia_extraer",
      "ia_sentimiento",
      "ia_resumir",
      "ia_traducir",
      "ia_spam",
    ];
    for (const tipo of viejos) {
      expect(NODO_TIPOS).not.toContain(tipo);
    }
  });

  it("incluye los dos tipos nuevos", () => {
    expect(NODO_TIPOS).toContain("ia_delegar");
    expect(NODO_TIPOS).toContain("crm_escalar_humano");
  });

  it("el catálogo total tiene exactamente 26 tipos (5 legacy + 21 del catálogo cerrado)", () => {
    expect(NODO_TIPOS).toHaveLength(26);
  });

  it("esCondicion trata ia_delegar como una condición de dos puertos", () => {
    expect(esCondicion("ia_delegar")).toBe(true);
    expect(esCondicion("msg_texto")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run tests/unit/workflows/catalogo-tipos.test.ts`
Expected: FAIL — `NODO_TIPOS` todavía tiene 62 entradas y no contiene `ia_delegar`/`crm_escalar_humano`.

- [ ] **Step 3: Reemplazar los arrays de catálogo en `src/types/workflows.ts`**

Reemplazar el bloque completo desde `// Triggers (11 tipos)` hasta `// Internos (4 tipos)` (inclusive, las seis declaraciones `NODO_TIPOS_*` de categorías nuevas) por:

```typescript
// Triggers (8 tipos)
export const NODO_TIPOS_TRIGGER = [
  "trigger_mensaje",
  "trigger_cron",
  "trigger_manual",
  "trigger_etiqueta",
  "trigger_etiqueta_removida",
  "trigger_etapa",
  "trigger_lead_creado",
  "trigger_inactividad",
] as const;

// Mensajería (2 tipos)
export const NODO_TIPOS_MENSAJERIA = ["msg_texto", "msg_plantilla"] as const;

// CRM (6 tipos)
export const NODO_TIPOS_CRM = [
  "crm_etiqueta_add",
  "crm_etiqueta_remove",
  "crm_etapa",
  "crm_vendedor",
  "crm_round_robin",
  "crm_escalar_humano",
] as const;

// Lógica (3 tipos)
export const NODO_TIPOS_LOGICA = ["logica_condicion", "logica_esperar", "logica_detener"] as const;

// IA (1 tipo) — reemplaza a los 7 nodos de IA sueltos: el agente vendedor real
// ya sabe clasificar, responder y extraer datos al Twin. Un solo paso delega
// el tramo completo de la conversación, no fragmenta sus capacidades en nodos.
export const NODO_TIPOS_IA = ["ia_delegar"] as const;

// Internos (1 tipo)
export const NODO_TIPOS_INTERNO = ["int_notif_vendedor"] as const;
```

Eliminar por completo la declaración `NODO_TIPOS_INTEGRACION` y el tipo `NodoTipoIntegracion` — no queda ninguna categoría de integración genérica (spec §4: "sin caso de uso real en este negocio hoy").

Actualizar `NODO_TIPOS` (la unión de todas las categorías) quitando el spread de `NODO_TIPOS_INTEGRACION`:

```typescript
export const NODO_TIPOS = [
  ...NODO_TIPOS_LEGACY,
  ...NODO_TIPOS_TRIGGER,
  ...NODO_TIPOS_MENSAJERIA,
  ...NODO_TIPOS_CRM,
  ...NODO_TIPOS_LOGICA,
  ...NODO_TIPOS_IA,
  ...NODO_TIPOS_INTERNO,
] as const;
```

Quitar `NodoTipoIntegracion` de la lista de exports de tipos por categoría, y quitar `"integracion"` de `CategoriaVisual` y de `categoriaDeTipo()` (la rama `if ((NODO_TIPOS_INTEGRACION as readonly string[]).includes(tipo)) return "integracion";` desaparece junto con el array).

- [ ] **Step 4: Ampliar `esCondicion` para reconocer `ia_delegar`**

En la sección de clasificadores compartidos (donde ya viven `esTrigger`, `esCondicion`, `esEspera`, `esFinal`, agregados hoy), reemplazar:

```typescript
export function esCondicion(tipo: NodoTipo): boolean {
  return tipo === "condicion" || tipo === "logica_condicion";
}
```

por:

```typescript
export function esCondicion(tipo: NodoTipo): boolean {
  // ia_delegar también tiene dos puertos: "verdadero" cuando el tramo delegado
  // termina en continuar, "falso" cuando termina en escalar a humano — ver
  // handlers/ia.ts. No es semánticamente una condición, pero comparte la forma.
  return tipo === "condicion" || tipo === "logica_condicion" || tipo === "ia_delegar";
}
```

- [ ] **Step 5: Correr el test de nuevo, confirmar que pasa**

Run: `npx vitest run tests/unit/workflows/catalogo-tipos.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Confirmar que nada más se rompió — el resto del código todavía referencia tipos que se acaban de borrar en switches no exhaustivos, así que typecheck debe seguir limpio**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin salida (0 errores). Si aparece algún error, es en un lugar con un switch exhaustivo sobre `NodoTipo` que no se había detectado antes — anotarlo y resolverlo agregando el caso o un `default`, no revirtiendo la poda.

- [ ] **Step 7: Commit**

```bash
git add src/types/workflows.ts tests/unit/workflows/catalogo-tipos.test.ts
git commit -m "feat(workflows): catalogo cerrado de tipos de nodo (spec unificado)"
```

---

### Task 2: Podar los handlers a los tipos que sobreviven

**Files:**

- Modify: `src/lib/workflows/engine/handlers/mensajeria.ts`
- Modify: `src/lib/workflows/engine/handlers/crm.ts`
- Modify: `src/lib/workflows/engine/handlers/logica.ts`
- Modify: `src/lib/workflows/engine/handlers/trigger.ts`
- Modify: `src/lib/workflows/engine/handlers/interno.ts`
- Modify: `src/lib/workflows/engine/handlers/index.ts`
- Delete: `src/lib/workflows/engine/handlers/integracion.ts`
- Modify: `src/lib/workflows/engine/handlers/ia.ts` (se vacía aquí; Task 4 lo llena con `ia_delegar`)

**Interfaces:**

- Consumes: el catálogo podado de Task 1.
- Produces: `tiposConHandler()` (ya existe en `registro.ts`) devuelve, tras esta poda, exactamente los tipos que Task 1 dejó en el catálogo (menos `ia_delegar`/`crm_escalar_humano`, que llegan en las Tasks 3-4).

No hay TDD nuevo en esta tarea — es una poda mecánica de funciones que ya no tienen tipo válido en el catálogo. La prueba de que la poda es correcta es que la suite completa (que ya cubre `validarGrafo`, el motor, y el servicio) sigue en verde y que un test nuevo confirma la lista final de handlers.

- [ ] **Step 1: Escribir el test de la lista final de handlers (falla porque hoy hay handlers para los tipos eliminados)**

Crear `tests/unit/workflows/engine/handlers-registrados.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { inicializarHandlers, tiposConHandler } from "@/lib/workflows/engine/handlers";

describe("handlers registrados — coinciden con el catálogo cerrado", () => {
  it("no queda ningún handler de integración genérica ni de los tipos de IA viejos", () => {
    inicializarHandlers();
    const tipos = tiposConHandler();
    const eliminados = [
      "int_http",
      "int_webhook_out",
      "int_codigo",
      "int_email",
      "int_sheets",
      "int_db",
      "ia_clasificar",
      "ia_responder",
      "ia_extraer",
      "ia_sentimiento",
      "ia_resumir",
      "ia_traducir",
      "ia_spam",
      "msg_botones",
      "msg_lista",
      "msg_imagen",
      "msg_documento",
      "msg_ubicacion",
      "msg_reaccion",
      "crm_campo",
      "crm_tarea",
      "crm_nota",
      "crm_spam",
      "crm_archivar",
      "logica_switch",
      "logica_validacion",
      "logica_esperar_respuesta",
      "logica_esperar_evento",
      "logica_loop",
      "logica_grupo",
      "logica_goto",
      "logica_error",
      "trigger_webhook",
      "trigger_vendedor_asignado",
      "trigger_formulario",
      "int_notif_grupo",
      "int_comentario",
      "int_debug",
    ];
    for (const tipo of eliminados) {
      expect(tipos).not.toContain(tipo);
    }
  });

  it("los handlers que sobreviven siguen registrados", () => {
    inicializarHandlers();
    const tipos = tiposConHandler();
    const sobrevivientes = [
      "msg_texto",
      "msg_plantilla",
      "crm_etiqueta_add",
      "crm_etiqueta_remove",
      "crm_etapa",
      "crm_vendedor",
      "crm_round_robin",
      "logica_condicion",
      "logica_esperar",
      "logica_detener",
      "trigger_mensaje",
      "trigger_cron",
      "trigger_manual",
      "trigger_etiqueta",
      "trigger_etiqueta_removida",
      "trigger_etapa",
      "trigger_lead_creado",
      "trigger_inactividad",
      "int_notif_vendedor",
    ];
    for (const tipo of sobrevivientes) {
      expect(tipos).toContain(tipo);
    }
  });
});
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run tests/unit/workflows/engine/handlers-registrados.test.ts`
Expected: FAIL — el primer `it` falla porque los handlers eliminados todavía están registrados.

- [ ] **Step 3: Podar `handlers/mensajeria.ts`**

Eliminar las funciones `msgBotones`, `msgLista`, `msgImagen`, `msgDocumento`, `msgUbicacion`, `msgReaccion` y sus líneas `registrarHandler(...)` correspondientes dentro de `registrarHandlersMensajeria()`. Quedan solo `msgTexto` y `msgPlantilla` (esta última se mantiene tal cual está — la plantilla "Reactivación de leads perdidos" del spec §6 la necesita para mandar HSM fuera de la ventana de 24h de Meta). `registrarHandlersMensajeria()` termina así:

```typescript
export function registrarHandlersMensajeria(): void {
  registrarHandler("msg_texto", msgTexto);
  registrarHandler("msg_plantilla", msgPlantilla);
}
```

- [ ] **Step 4: Podar `handlers/crm.ts`**

Eliminar las funciones `crmCampo`, `crmTarea`, `crmNota`, `crmSpam`, `crmArchivar` y sus líneas de registro. `registrarHandlersCrm()` (antes de que Task 3 le agregue `crm_escalar_humano`) queda:

```typescript
export function registrarHandlersCrm(): void {
  registrarHandler("crm_etiqueta_add", crmEtiquetaAdd);
  registrarHandler("crm_etiqueta_remove", crmEtiquetaRemove);
  registrarHandler("crm_etapa", crmEtapa);
  registrarHandler("crm_vendedor", crmVendedor);
  registrarHandler("crm_round_robin", crmRoundRobin);
}
```

- [ ] **Step 5: Podar `handlers/logica.ts`**

Eliminar las funciones `logicaSwitch`, `logicaValidacion`, `logicaEsperarRespuesta`, `logicaEsperarEvento`, `logicaLoop`, `logicaGrupo`, `logicaGoto`, `logicaError`, la función auxiliar `convertirAMs` si ya no la usa nadie tras la poda (queda usada por `logicaEsperar`, que sobrevive — no se borra), y sus líneas de registro. `registrarHandlersLogica()` queda:

```typescript
export function registrarHandlersLogica(): void {
  registrarHandler("logica_condicion", logicaCondicion);
  registrarHandler("logica_esperar", logicaEsperar);
  registrarHandler("logica_detener", logicaDetener);
}
```

- [ ] **Step 6: Podar `handlers/trigger.ts`**

Eliminar las funciones `triggerWebhook`, `triggerVendedorAsignado`, `triggerFormulario` y sus líneas de registro. `registrarHandlersTrigger()` queda:

```typescript
export function registrarHandlersTrigger(): void {
  registrarHandler("trigger_mensaje", triggerMensaje);
  registrarHandler("trigger_cron", triggerCron);
  registrarHandler("trigger_manual", triggerManual);
  registrarHandler("trigger_etiqueta", triggerEtiqueta);
  registrarHandler("trigger_etiqueta_removida", triggerEtiquetaRemovida);
  registrarHandler("trigger_etapa", triggerEtapa);
  registrarHandler("trigger_lead_creado", triggerLeadCreado);
  registrarHandler("trigger_inactividad", triggerInactividad);
}
```

- [ ] **Step 7: Podar `handlers/interno.ts`**

Eliminar las funciones `intNotifGrupo`, `intComentario`, `intDebug` y sus líneas de registro. `registrarHandlersInterno()` queda:

```typescript
export function registrarHandlersInterno(): void {
  registrarHandler("int_notif_vendedor", intNotifVendedor);
}
```

- [ ] **Step 8: Borrar `handlers/integracion.ts` por completo**

```bash
git rm src/lib/workflows/engine/handlers/integracion.ts
```

- [ ] **Step 9: Vaciar `handlers/ia.ts`**

Reemplazar todo el contenido del archivo por:

```typescript
/**
 * Handlers de IA.
 *
 * Un solo tipo: `ia_delegar` (Task 4 de este plan). Reemplaza a los siete
 * nodos de IA sueltos del catálogo descartado — el agente vendedor real ya
 * sabe clasificar, responder y extraer datos al Lead Twin; este handler sólo
 * decide cuándo un tramo delegado a él termina.
 */

export function registrarHandlersIa(): void {
  // Task 4 lo llena.
}
```

- [ ] **Step 10: Actualizar `handlers/index.ts`**

Quitar el import y la llamada a `registrarHandlersIntegracion` (el archivo ya no existe):

```typescript
export { registrarHandler, obtenerHandler, tieneHandler, tiposConHandler } from "./registro";
export type { Handler, ResultadoHandler } from "./registro";

import { registrarHandlersTrigger } from "./trigger";
import { registrarHandlersMensajeria } from "./mensajeria";
import { registrarHandlersCrm } from "./crm";
import { registrarHandlersLogica } from "./logica";
import { registrarHandlersIa } from "./ia";
import { registrarHandlersInterno } from "./interno";

let inicializado = false;

export function inicializarHandlers(): void {
  if (inicializado) return;

  registrarHandlersTrigger();
  registrarHandlersMensajeria();
  registrarHandlersCrm();
  registrarHandlersLogica();
  registrarHandlersIa();
  registrarHandlersInterno();

  inicializado = true;
}
```

- [ ] **Step 11: Correr el test de handlers-registrados de nuevo**

Run: `npx vitest run tests/unit/workflows/engine/handlers-registrados.test.ts`
Expected: PASS (2 tests) — el segundo `it` sigue pasando porque ningún sobreviviente se tocó; el primero ahora pasa porque los eliminados ya no están.

- [ ] **Step 12: Correr toda la suite de workflows y el typecheck completo**

Run: `npx vitest run tests/unit/workflows/`
Expected: todos los test files en verde. Si `evaluador-condicion.test.ts` o `interpolador-variables.test.ts` fallan, es señal de que se borró algo por error — revisar el diff antes de seguir.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

- [ ] **Step 13: Commit**

```bash
git add src/lib/workflows/engine/handlers/
git commit -m "refactor(workflows): podar handlers a los tipos del catalogo cerrado"
```

---

### Task 3: TDD — handler `crm_escalar_humano`

**Files:**

- Modify: `src/lib/workflows/engine/handlers/crm.ts`
- Test: `tests/unit/workflows/engine/handlers/crm-escalar-humano.test.ts` (nuevo)

**Interfaces:**

- Consumes: `ResultadoHandler`, `registrarHandler` de `./registro`; `ContextoEjecucion` de `../contexto-ejecucion`; `crearContextoVacio` de `../contexto-ejecucion` (para el fixture del test).
- Produces: handler registrado bajo `"crm_escalar_humano"`, consumido por Task 6 (validación de config) y por la plantilla "Escalar a humano" del plan de Plantillas (fuera de este plan).

- [ ] **Step 1: Escribir el test (falla: el handler no existe todavía)**

```typescript
import { describe, expect, it } from "vitest";
import { crearContextoVacio } from "@/lib/workflows/engine/contexto-ejecucion";
import { inicializarHandlers, obtenerHandler } from "@/lib/workflows/engine/handlers";

function ctxDePrueba() {
  return crearContextoVacio({
    workflowId: "wf-1",
    runId: "run-1",
    versionId: "ver-1",
    trigger: { tipo: "manual", datos: {} },
  });
}

describe("handler crm_escalar_humano", () => {
  it("con un reason_code valido, devuelve puerto salida y lo lleva a la salida", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("crm_escalar_humano")!;
    const resultado = await handler({ reason_code: "quote_limit" }, ctxDePrueba());

    expect(resultado.puerto).toBe("salida");
    expect(resultado.salida?.reason_code).toBe("quote_limit");
    expect(resultado.contexto?.escalado_a_humano).toBe(true);
  });

  it("sin reason_code, tira error", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("crm_escalar_humano")!;
    await expect(handler({}, ctxDePrueba())).rejects.toThrow(/reason_code/);
  });

  it("con un reason_code que no es de los ocho validos, tira error", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("crm_escalar_humano")!;
    await expect(handler({ reason_code: "motivo_inventado" }, ctxDePrueba())).rejects.toThrow(
      /reason_code/,
    );
  });
});
```

- [ ] **Step 2: Correr el test, confirmar que falla**

Run: `npx vitest run tests/unit/workflows/engine/handlers/crm-escalar-humano.test.ts`
Expected: FAIL — `obtenerHandler("crm_escalar_humano")` devuelve `undefined`, el test truena al invocarlo como función.

- [ ] **Step 3: Implementar el handler en `handlers/crm.ts`**

Agregar antes de `// Registrar todos los handlers de CRM`:

```typescript
/**
 * Los ocho valores de `HandoffEvent.reason_code` (src/types/entities.ts).
 * No hay una constante exportada allá para reusar — este array la refleja.
 */
const REASON_CODES_VALIDOS = [
  "unknown_intents",
  "sensitive_keyword",
  "quote_limit",
  "discount_limit",
  "rule_handoff",
  "manual_pause",
  "manual_resume",
  "other",
] as const;

/**
 * Escalar la sesión a un humano, con el motivo tipado.
 */
async function crmEscalarHumano(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const reasonCode = config.reason_code as string | undefined;

  if (!reasonCode || !(REASON_CODES_VALIDOS as readonly string[]).includes(reasonCode)) {
    throw new Error(
      `El nodo crm_escalar_humano requiere un reason_code válido (uno de: ${REASON_CODES_VALIDOS.join(", ")})`,
    );
  }

  return {
    puerto: "salida",
    contexto: {
      escalado_a_humano: true,
      escalado_reason_code: reasonCode,
    },
    salida: {
      tipo: "crm_escalar_humano",
      reason_code: reasonCode,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}
```

Y agregar el registro:

```typescript
export function registrarHandlersCrm(): void {
  registrarHandler("crm_etiqueta_add", crmEtiquetaAdd);
  registrarHandler("crm_etiqueta_remove", crmEtiquetaRemove);
  registrarHandler("crm_etapa", crmEtapa);
  registrarHandler("crm_vendedor", crmVendedor);
  registrarHandler("crm_round_robin", crmRoundRobin);
  registrarHandler("crm_escalar_humano", crmEscalarHumano);
}
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `npx vitest run tests/unit/workflows/engine/handlers/crm-escalar-humano.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/engine/handlers/crm.ts tests/unit/workflows/engine/handlers/crm-escalar-humano.test.ts
git commit -m "feat(workflows): handler crm_escalar_humano"
```

---

### Task 4: TDD — handler `ia_delegar`

**Files:**

- Modify: `src/lib/workflows/engine/handlers/ia.ts`
- Test: `tests/unit/workflows/engine/handlers/ia-delegar.test.ts` (nuevo)

**Interfaces:**

- Consumes: `evaluarCondicion`, `type Condicion` de `../evaluador-condicion`; `ContextoEjecucion` de `../contexto-ejecucion`; `registrarHandler`, `type ResultadoHandler` de `./registro`.
- Produces: handler registrado bajo `"ia_delegar"`. Config shape que consumirá Task 6 (validación) y la plantilla "Bienvenida + agente" (plan de Plantillas, fuera de este plan):
  ```typescript
  {
    instrucciones_adicionales?: string
    condicion_contenido?:
      | { tipo: "intent_detectado", intents: string[] }
      | { tipo: "campo_twin", campo: string, operador: OperadorCondicion, valor?: unknown }
    al_retornar_por_contenido?: "continuar" | "escalar_humano"   // default "continuar"
    timeout_minutos?: number                                     // default 1440 (24h)
    al_retornar_por_timeout?: "continuar" | "escalar_humano"     // default "continuar"
  }
  ```

**Diseño del mecanismo de espera** (spec §5): el handler no ejecuta nada activo — el agente vendedor real sigue respondiendo cada mensaje por su cuenta, fuera del motor. Este handler sólo decide, cada vez que se ejecuta (primera vez o al reanudar por un evento externo), si ya hay que cortar:

1. Si `condicion_contenido` está configurada y se cumple contra el contexto actual → corta ya, puerto según `al_retornar_por_contenido`.
2. Si no, calcula (la primera vez) o recupera (en reanudaciones, desde `ctx.variables`) la fecha límite del timeout. Si ya venció → corta, puerto según `al_retornar_por_timeout`.
3. Si ninguna de las dos aplica todavía → devuelve `esperar: { tipo: "evento" }` con puerto `"salida"` — un puerto que `ia_delegar` nunca conecta (sus dos aristas reales son `"verdadero"`/`"falso"`, exigidas por `esCondicion` de Task 1), así que el motor no encuentra arista y reanuda en el mismo nodo (`ejecutar-workflow.ts`: `ctx.nodoActual = siguiente ?? nodo.id`) — la próxima vez que algo dispare una reanudación, este handler vuelve a correr desde el punto 1.

La fecha límite se guarda con una key por nodo (`_ia_delegar_limite_<nodoId>`, usando `ctx.nodoActual`) para que dos pasos `ia_delegar` distintos en el mismo flujo no compartan límite.

- [ ] **Step 1: Escribir los tests (fallan: el handler no existe)**

```typescript
import { describe, expect, it } from "vitest";
import {
  crearContextoVacio,
  type ContextoEjecucion,
} from "@/lib/workflows/engine/contexto-ejecucion";
import { inicializarHandlers, obtenerHandler } from "@/lib/workflows/engine/handlers";
import type { LeadSession } from "@/types/entities";

function ctxDePrueba(overrides: Partial<ContextoEjecucion> = {}): ContextoEjecucion {
  const base = crearContextoVacio({
    workflowId: "wf-1",
    runId: "run-1",
    versionId: "ver-1",
    trigger: { tipo: "manual", datos: {} },
  });
  return { ...base, nodoActual: "ia-1", ...overrides };
}

describe("handler ia_delegar", () => {
  it("sin condicion_contenido, primera ejecucion: siempre espera con el timeout configurado", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const antes = Date.now();
    const resultado = await handler({ timeout_minutos: 60 }, ctxDePrueba());

    expect(resultado.esperar?.tipo).toBe("evento");
    expect(resultado.puerto).toBe("salida");
    const haciaAdelante = resultado.esperar!.hasta.getTime() - antes;
    expect(haciaAdelante).toBeGreaterThan(59 * 60_000);
    expect(haciaAdelante).toBeLessThanOrEqual(60 * 60_000 + 1000);
  });

  it("sin timeout_minutos explicito, usa el default de 24 horas", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const antes = Date.now();
    const resultado = await handler({}, ctxDePrueba());

    const haciaAdelante = resultado.esperar!.hasta.getTime() - antes;
    expect(haciaAdelante).toBeGreaterThan(23 * 60 * 60_000);
    expect(haciaAdelante).toBeLessThanOrEqual(24 * 60 * 60_000 + 1000);
  });

  it("condicion_contenido tipo campo_twin ya cumplida: corta con puerto verdadero (continuar por default)", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const ctx = ctxDePrueba({ sesion: { tiene_cotizacion: true } as unknown as LeadSession });
    const resultado = await handler(
      {
        condicion_contenido: {
          tipo: "campo_twin",
          campo: "sesion.tiene_cotizacion",
          operador: "es",
          valor: true,
        },
      },
      ctx,
    );

    expect(resultado.puerto).toBe("verdadero");
    expect(resultado.esperar).toBeUndefined();
  });

  it("condicion_contenido cumplida + al_retornar_por_contenido escalar_humano: corta con puerto falso", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const ctx = ctxDePrueba({ sesion: { tiene_cotizacion: true } as unknown as LeadSession });
    const resultado = await handler(
      {
        condicion_contenido: {
          tipo: "campo_twin",
          campo: "sesion.tiene_cotizacion",
          operador: "es",
          valor: true,
        },
        al_retornar_por_contenido: "escalar_humano",
      },
      ctx,
    );

    expect(resultado.puerto).toBe("falso");
  });

  it("condicion_contenido tipo intent_detectado, matchea el intent del trigger", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const ctx = ctxDePrueba({
      trigger: { tipo: "mensaje", datos: { intent_detectado: "consulta_producto" } },
    });
    const resultado = await handler(
      {
        condicion_contenido: {
          tipo: "intent_detectado",
          intents: ["consulta_producto", "reclamo"],
        },
      },
      ctx,
    );

    expect(resultado.puerto).toBe("verdadero");
  });

  it("condicion_contenido tipo intent_detectado que NO matchea: sigue esperando", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const ctx = ctxDePrueba({
      trigger: { tipo: "mensaje", datos: { intent_detectado: "otra_cosa" } },
    });
    const resultado = await handler(
      { condicion_contenido: { tipo: "intent_detectado", intents: ["consulta_producto"] } },
      ctx,
    );

    expect(resultado.esperar?.tipo).toBe("evento");
  });

  it("reanudacion con el limite guardado ya vencido: corta por timeout, no vuelve a esperar", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const ctx = ctxDePrueba();
    ctx.variables.set("_ia_delegar_limite_ia-1", new Date(Date.now() - 1000).toISOString());

    const resultado = await handler({ al_retornar_por_timeout: "escalar_humano" }, ctx);

    expect(resultado.esperar).toBeUndefined();
    expect(resultado.puerto).toBe("falso");
  });

  it("reanudacion con el limite guardado todavia vigente: sigue esperando hasta ese mismo limite", async () => {
    inicializarHandlers();
    const handler = obtenerHandler("ia_delegar")!;
    const ctx = ctxDePrueba();
    const limiteFuturo = new Date(Date.now() + 5 * 60_000);
    ctx.variables.set("_ia_delegar_limite_ia-1", limiteFuturo.toISOString());

    const resultado = await handler({ timeout_minutos: 999 }, ctx);

    expect(resultado.esperar?.hasta.getTime()).toBe(limiteFuturo.getTime());
  });
});
```

- [ ] **Step 2: Correr los tests, confirmar que fallan**

Run: `npx vitest run tests/unit/workflows/engine/handlers/ia-delegar.test.ts`
Expected: FAIL en todos — `obtenerHandler("ia_delegar")` devuelve `undefined`.

- [ ] **Step 3: Implementar el handler en `handlers/ia.ts`**

```typescript
/**
 * Handlers de IA.
 *
 * Un solo tipo: `ia_delegar`. Reemplaza a los siete nodos de IA sueltos del
 * catálogo descartado — el agente vendedor real ya sabe clasificar,
 * responder y extraer datos al Lead Twin; este handler sólo decide cuándo un
 * tramo delegado a él termina.
 *
 * No ejecuta nada activo: mientras está "en curso", el agente vendedor de
 * siempre sigue respondiendo cada mensaje fuera de este motor. El handler
 * sólo se re-evalúa cada vez que algo dispara una reanudación (spec §5).
 */

import { evaluarCondicion, type Condicion } from "../evaluador-condicion";
import type { ContextoEjecucion } from "../contexto-ejecucion";
import { registrarHandler, type ResultadoHandler } from "./registro";

const TIMEOUT_MINUTOS_DEFAULT = 1440; // 24 horas — nunca deja un tramo delegado sin destino.

type AlRetornar = "continuar" | "escalar_humano";

interface CondicionContenidoIntent {
  tipo: "intent_detectado";
  intents: string[];
}

interface CondicionContenidoTwin {
  tipo: "campo_twin";
  campo: string;
  operador: Condicion["operador"];
  valor?: unknown;
}

type CondicionContenido = CondicionContenidoIntent | CondicionContenidoTwin;

function evaluarCondicionContenido(cc: CondicionContenido, ctx: ContextoEjecucion): boolean {
  if (cc.tipo === "intent_detectado") {
    const intentActual = ctx.trigger.datos.intent_detectado as string | undefined;
    return intentActual !== undefined && cc.intents.includes(intentActual);
  }
  return evaluarCondicion({ campo: cc.campo, operador: cc.operador, valor: cc.valor }, ctx);
}

function puertoDe(alRetornar: AlRetornar): "verdadero" | "falso" {
  return alRetornar === "escalar_humano" ? "falso" : "verdadero";
}

async function iaDelegar(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const condicionContenido = config.condicion_contenido as CondicionContenido | undefined;
  const alRetornarPorContenido = (config.al_retornar_por_contenido as AlRetornar) ?? "continuar";
  const alRetornarPorTimeout = (config.al_retornar_por_timeout as AlRetornar) ?? "continuar";
  const timeoutMinutos =
    typeof config.timeout_minutos === "number" ? config.timeout_minutos : TIMEOUT_MINUTOS_DEFAULT;

  if (condicionContenido && evaluarCondicionContenido(condicionContenido, ctx)) {
    return {
      puerto: puertoDe(alRetornarPorContenido),
      salida: { tipo: "ia_delegar", motivo_retorno: "contenido" },
    };
  }

  const keyLimite = `_ia_delegar_limite_${ctx.nodoActual}`;
  const limiteGuardado = ctx.variables.get(keyLimite) as string | undefined;
  const limite = limiteGuardado
    ? new Date(limiteGuardado)
    : new Date(Date.now() + timeoutMinutos * 60_000);

  if (Date.now() >= limite.getTime()) {
    return {
      puerto: puertoDe(alRetornarPorTimeout),
      salida: { tipo: "ia_delegar", motivo_retorno: "timeout" },
    };
  }

  return {
    puerto: "salida", // Sin arista real (ia_delegar sólo conecta verdadero/falso): el
    // motor cae a "reanudar en mí mismo" — ver ejecutar-workflow.ts.
    contexto: { [keyLimite]: limite.toISOString() },
    salida: { tipo: "ia_delegar", motivo_retorno: "pendiente" },
    esperar: { tipo: "evento", hasta: limite, timeout: true },
  };
}

export function registrarHandlersIa(): void {
  registrarHandler("ia_delegar", iaDelegar);
}
```

- [ ] **Step 4: Correr los tests, confirmar que pasan**

Run: `npx vitest run tests/unit/workflows/engine/handlers/ia-delegar.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Correr toda la suite de workflows**

Run: `npx vitest run tests/unit/workflows/`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/engine/handlers/ia.ts tests/unit/workflows/engine/handlers/ia-delegar.test.ts
git commit -m "feat(workflows): handler ia_delegar, el paso de delegacion al agente"
```

---

### Task 5: `ia_delegar` valida como condición de dos puertos en `validar-grafo.ts`

**Files:**

- Test: `tests/unit/workflows/validar-grafo.test.ts` (ya existe, agregar casos)

**Interfaces:**

- Consumes: `esCondicion` ampliado en Task 1 — `validar-grafo.ts` ya lo usa vía `puertosDe`/`condicion_puertos`/`salida_sin_conectar`, así que esta tarea es sólo de verificación, no de código nuevo en `validar-grafo.ts`.

- [ ] **Step 1: Agregar los casos al describe de catálogo nuevo**

En `tests/unit/workflows/validar-grafo.test.ts`, dentro de `describe("validarGrafo — catálogo nuevo (57 tipos), no solo el legacy"`, agregar (el nombre del describe se queda como está — no hace falta renombrarlo, cubre "todo lo que no es legacy"):

```typescript
it("ia_delegar con las dos salidas conectadas es valido", () => {
  const g = grafo(
    [
      nodo("t", "trigger_manual"),
      nodo("ia", "ia_delegar"),
      nodo("f1", "logica_detener"),
      nodo("f2", "logica_detener"),
    ],
    [arista("t", "ia"), arista("ia", "f1", "verdadero"), arista("ia", "f2", "falso")],
  );
  expect(validarGrafo(g)).toEqual([]);
});

it("ia_delegar sin la rama falso reporta condicion_puertos", () => {
  const g = grafo(
    [nodo("t", "trigger_manual"), nodo("ia", "ia_delegar"), nodo("f1", "logica_detener")],
    [arista("t", "ia"), arista("ia", "f1", "verdadero")],
  );
  const problemas = validarGrafo(g);
  expect(problemas).toHaveLength(1);
  expect(problemas[0]?.regla).toBe("condicion_puertos");
});
```

- [ ] **Step 2: Correr el test — debería pasar directo (esCondicion ya se amplió en Task 1)**

Run: `npx vitest run tests/unit/workflows/validar-grafo.test.ts`
Expected: PASS (26 tests: los 24 de antes + estos 2).

Si alguno de los dos falla, es porque Task 1 no se completó correctamente — volver a Task 1 antes de seguir, no parchear acá.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/workflows/validar-grafo.test.ts
git commit -m "test(workflows): ia_delegar valida como condicion de dos puertos"
```

---

### Task 6: `validar-workflow.ts` — actualizar `validarConfigNodo`

**Files:**

- Modify: `src/lib/workflows/validar-workflow.ts`

**Interfaces:**

- Consumes: nada nuevo — usa `nodo.tipo`/`nodo.config` como ya lo hacía.
- Produces: nada que otra task consuma — este archivo sigue siendo huérfano (nadie lo importa todavía, ver spec §2, tabla "se conserva"; el plan del Editor lo cablea).

Este archivo no tiene test dedicado hoy (es huérfano — ver hallazgo de la sesión anterior). No se le agrega uno en este plan: cablearlo es trabajo del plan del Editor, que sí lo va a ejercitar de punta a punta. Acá sólo se mantiene consistente con el catálogo podado para que no falle en silencio el día que se cablee.

- [ ] **Step 1: Quitar del switch `validarConfigNodo` los `case` de tipos que Task 1/2 eliminaron**

Quitar los casos: `msg_botones`, `msg_lista`, `msg_imagen` (fusionado con `msg_documento` en un solo `case` — separar `msg_documento` en su propio `case` que ya no aplica, eliminarlo también), `int_http`, `int_webhook_out`, `int_email`, `int_codigo`, `logica_switch`. `crm_round_robin` NO se toca — ya vive en el bloque "sin validación adicional" y sigue existiendo en el catálogo, se queda ahí tal cual. Del bloque final "Tipos que no requieren configuración adicional" quitar las líneas: `logica_goto`, `logica_grupo`, `logica_validacion`, `logica_loop`, `logica_error`, `logica_esperar_evento`, `msg_ubicacion`, `msg_reaccion`, `crm_tarea`, `crm_nota`, `crm_spam`, `crm_archivar`, `int_sheets`, `int_db`, `ia_clasificar`, `ia_extraer`, `ia_sentimiento`, `ia_resumir`, `ia_traducir`, `ia_spam`, `int_notif_grupo`, `int_comentario`, `int_debug`. Quitar también el `case "logica_esperar_respuesta":` completo (con su cuerpo de warning) — ya no existe ese tipo. `crm_round_robin` e `int_notif_vendedor` se quedan en ese bloque, no se tocan.

- [ ] **Step 2: Agregar validación para `crm_escalar_humano`**

Agregar en la sección `// --- CRM ---`:

```typescript
case "crm_escalar_humano": {
  const reasonCode = config["reason_code"];
  if (!reasonCode) {
    errores.push({
      tipo: "error",
      mensaje: "Selecciona el motivo del escalado",
    });
  }
  break;
}
```

- [ ] **Step 3: Agregar validación para `ia_delegar`**

Agregar una sección nueva `// --- IA ---` (reemplaza al viejo `case "ia_responder":` que ya no existe):

```typescript
// --- IA ---
case "ia_delegar": {
  const timeout = config["timeout_minutos"];
  if (timeout !== undefined && (typeof timeout !== "number" || timeout <= 0)) {
    errores.push({
      tipo: "error",
      mensaje: "El tiempo máximo de espera tiene que ser un número positivo",
    });
  }
  const condicionContenido = config["condicion_contenido"] as
    | { tipo?: string; intents?: unknown; campo?: unknown }
    | undefined;
  if (condicionContenido?.tipo === "intent_detectado" && !Array.isArray(condicionContenido.intents)) {
    errores.push({
      tipo: "error",
      mensaje: "Selecciona al menos un intent para que el agente devuelva el control",
    });
  }
  if (condicionContenido?.tipo === "campo_twin" && !condicionContenido.campo) {
    errores.push({
      tipo: "error",
      mensaje: "Selecciona qué campo del Lead Twin corta la delegación",
    });
  }
  break;
}
```

- [ ] **Step 4: Confirmar que el resto del bloque "Tipos que no requieren configuración adicional" sigue siendo consistente**

Debe quedar así (sólo los tipos que sobreviven del catálogo y no tienen validación propia):

```typescript
case "trigger_mensaje":
case "trigger_manual":
case "trigger_lead_creado":
case "crm_round_robin":
case "int_notif_vendedor":
case "disparador":
case "accion":
case "fin":
case "logica_detener":
  // Sin validación específica adicional
  break;
```

- [ ] **Step 5: Typecheck y lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

Run: `npm run lint`
Expected: sin errores nuevos (los warnings de boundaries preexistentes siguen igual).

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/validar-workflow.ts
git commit -m "refactor(workflows): validar-workflow.ts al catalogo cerrado"
```

---

### Task 7: Verificación final

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: todos los test files en verde, sin regresiones fuera de `workflows/`.

- [ ] **Step 2: Typecheck completo**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

- [ ] **Step 3: Lint completo**

Run: `npm run lint`
Expected: sin errores (los warnings de boundaries deprecados preexistentes no cuentan).

- [ ] **Step 4: Confirmar que "Probar" (ya cableado en la sesión anterior) sigue funcionando con el catálogo nuevo**

El test `tests/unit/workflows-admin-service.test.ts` (`DefaultWorkflowsAdminService.probar`) ya ejercita `trigger_manual -> msg_texto -> logica_detener` de punta a punta — correrlo solo, para confirmar que la poda no lo rompió:

Run: `npx vitest run tests/unit/workflows-admin-service.test.ts`
Expected: 26 tests en verde (los mismos de antes de este plan).

- [ ] **Step 5: Reportar en el chat lo que quedó explícitamente fuera de este plan**

No implementado en este plan (según la descomposición acordada): las 6 plantillas, el editor de lista vertical, el wiring a Inngest (Paso 0 del spec §9), y las 4 migraciones. Todo eso son planes separados que consumen lo que este plan deja construido.
