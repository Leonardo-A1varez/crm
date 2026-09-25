import { describe, expect, it, vi } from "vitest";
import type { CrmInngestClient } from "@/inngest/client";
import type { AppEnv } from "@/lib/env";
import type { AppClient } from "@/server/db/client";
import { LeaseLock } from "@/server/lock/lease-lock";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";
import type { PuertosAcciones } from "@/server/services/workflows/acciones/registro";

/**
 * Cada lugar que arma EL registro de acciones le pasa todos los puertos.
 *
 * `supresiones` es opcional en el tipo de `enviar_mensaje`, así que olvidarlo
 * compila: la acción recién lo nota en runtime, cuando falla cerrado y no
 * manda. Pasó —producción armaba el registro sin la lista de bajas y todo
 * "Enviar mensaje" de un flujo fallaba—, y la suite no lo vio porque ningún
 * test armaba el registro con el bootstrap real.
 *
 * Se espía `crearRegistroDeAcciones` para ver los puertos con que lo llaman
 * los bootstraps de verdad, sin tocar la base.
 */

const llamadas: PuertosAcciones[] = [];

vi.mock("@/server/services/workflows/acciones/registro", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/services/workflows/acciones/registro")>();
  return {
    ...original,
    crearRegistroDeAcciones: (puertos: PuertosAcciones) => {
      llamadas.push(puertos);
      return original.crearRegistroDeAcciones(puertos);
    },
  };
});

/**
 * Todas las claves de los puertos. `satisfies` contra `keyof PuertosAcciones`:
 * un puerto nuevo que no se agregue acá no compila, y entonces no puede quedar
 * sin chequear.
 */
const PUERTOS = {
  tags: true,
  sessions: true,
  handoff: true,
  messages: true,
  metaApi: true,
  conversations: true,
  leads: true,
  users: true,
  configProvider: true,
  supresiones: true,
  asignacion: true,
  avisos: true,
  candadoReparto: true,
} as const satisfies Record<keyof PuertosAcciones, true>;

function faltantes(puertos: PuertosAcciones): string[] {
  return Object.keys(PUERTOS).filter(
    (clave) => puertos[clave as keyof PuertosAcciones] === undefined,
  );
}

function envDePrueba(): AppEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    INNGEST_EVENT_KEY: "test-event-key",
    INNGEST_SIGNING_KEY: "test-signing-key",
    OPENAI_API_KEY: "sk-test",
    META_APP_SECRET: "test-meta-secret",
    META_VERIFY_TOKEN: "test-verify",
    META_WHATSAPP_PHONE_NUMBER_ID: "0",
    META_WHATSAPP_ACCESS_TOKEN: "test-token",
    META_GRAPH_API_VERSION: "v26.0",
    LLM_DAILY_CAP_USD: 10,
    LLM_MODE: "mock",
  };
}

/**
 * Timeout propio del caso de producción: casi todo su tiempo es el primer
 * `import("@/inngest/bootstrap")`, que carga el grafo entero del motor —todos
 * los repos de Supabase, los servicios y las funciones de Inngest— más
 * inngest, ai, supabase-js y pino, sin ningún efecto de módulo evitable (ni red ni disco: schemas de zod y el parse
 * de env en modo test). Es el tamaño del grafo, no un bug.
 *
 * Medido el 2026-09-25 con los comandos de abajo: 2,4 s solo y 4,99 s con la
 * suite completa, donde los workers compiten por CPU. Con el default de 5 s
 * había fallado 2 de 4 corridas de la suite. 20 s es cuatro veces el peor caso
 * medido.
 *
 * Solo:           npx vitest run --reporter=verbose tests/unit/workflows/registro-puertos-completos.test.ts
 * Suite completa: npx vitest run --reporter=verbose | grep "lista de bajas real"
 */
const TIMEOUT_IMPORT_BOOTSTRAP_MS = 20_000;

describe("el registro de acciones recibe todos sus puertos", () => {
  it(
    "producción (inngest/bootstrap): enviar_mensaje tiene la lista de bajas real",
    { timeout: TIMEOUT_IMPORT_BOOTSTRAP_MS },
    async () => {
      const { makeInngestDeps } = await import("@/inngest/bootstrap");
      llamadas.length = 0;

      const { deps } = makeInngestDeps({
        env: envDePrueba(),
        db: {} as AppClient,
        inngest: { send: vi.fn() } as unknown as CrmInngestClient,
      });

      expect(llamadas).toHaveLength(1);
      const [puertos] = llamadas;
      expect(faltantes(puertos!)).toEqual([]);
      expect(puertos!.supresiones).toBeInstanceOf(SupabaseDifusionSupresionesRepository);
      // La misma lista que usa la baja por palabra: una baja recién escrita la
      // ve el próximo envío.
      expect(puertos!.supresiones).toBe(deps.onMessageReceived.supresiones);
      expect(deps.workflowSegmento.registro.soporta(nodoEnviar())).toBe(true);
      // El reparto de producción serializa con el candado de Postgres, no con
      // uno en memoria que sólo vale dentro de una instancia.
      expect(puertos!.candadoReparto).toBeInstanceOf(LeaseLock);
    },
  );

  it("el bootstrap de los smoke tests también", async () => {
    const { makeSmokeBundle } = await import("../../smoke/smoke-bootstrap");
    llamadas.length = 0;

    makeSmokeBundle();

    expect(llamadas).toHaveLength(1);
    expect(faltantes(llamadas[0]!)).toEqual([]);
    expect(llamadas[0]!.supresiones).toBeInstanceOf(InMemoryDifusionSupresionesRepository);
  });

  it("Probar (correrPrueba) arma el registro con la lista de bajas que recibe", async () => {
    const { correrPrueba, sesionSimulada } =
      await import("@/server/services/workflows/simulador.service");
    const supresiones = new InMemoryDifusionSupresionesRepository();
    const desde = new Date("2026-09-24T12:00:00Z");
    llamadas.length = 0;

    await correrPrueba({
      grafo: { nodos: [], aristas: [] },
      maxPasos: 1,
      desde,
      contexto: {},
      lead: {
        id: "lead-1",
        nombre: "Ana",
        nombre_perfil: null,
        telefono: "+5491100000000",
        email: null,
        direccion: null,
        datos_extra: {},
        vehiculo_marca: null,
        vehiculo_modelo: null,
        vehiculo_anio: null,
        vehiculo_motor: null,
        empresa_id: null,
        canal_origen: "wa",
        meta_user_ids: {},
        created_at: desde,
        updated_at: desde,
      },
      sesion: sesionSimulada("lead-1", desde),
      runId: "prueba",
      supresiones,
    });

    expect(llamadas).toHaveLength(1);
    expect(faltantes(llamadas[0]!)).toEqual([]);
    expect(llamadas[0]!.supresiones).toBe(supresiones);
  });
});

function nodoEnviar() {
  return {
    id: "env",
    tipo: "accion" as const,
    config: { accion: "enviar_mensaje", texto: "hola" },
    posicion: { x: 0, y: 0 },
  };
}
