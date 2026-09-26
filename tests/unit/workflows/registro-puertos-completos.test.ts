import { describe, expect, it, vi } from "vitest";
import type { CrmInngestClient } from "@/inngest/client";
import type { AppEnv } from "@/lib/env";
import type { AppClient } from "@/server/db/client";
import { LeaseLock } from "@/server/lock/lease-lock";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";
import type { PuertosAcciones } from "@/server/services/workflows/acciones/registro";
import { cargaPesada } from "../../helpers/carga-pesada";

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
  plantillasSinSesion: true,
  imagenesDeFlujo: true,
  avisarEquipo: true,
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

// Los dos bootstraps cargan el grafo entero del motor: una vez por archivo, con
// el timeout y la medición de `carga-pesada.ts`. Dinámicos y no estáticos
// porque el `vi.mock` de arriba anota en `llamadas`, que un import estático
// —que corre antes de declararla— no alcanzaría.
const bootstrap = cargaPesada(() => import("@/inngest/bootstrap"));
const smokeBootstrap = cargaPesada(() => import("../../smoke/smoke-bootstrap"));

describe("el registro de acciones recibe todos sus puertos", () => {
  it("producción (inngest/bootstrap): enviar_mensaje tiene la lista de bajas real", () => {
    const { makeInngestDeps } = bootstrap();
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
  });

  it("el bootstrap de los smoke tests también", () => {
    const { makeSmokeBundle } = smokeBootstrap();
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
