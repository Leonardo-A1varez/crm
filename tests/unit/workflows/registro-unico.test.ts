import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CrmInngestClient } from "@/inngest/client";
import { makeInngestDeps } from "@/inngest/bootstrap";
import type { AppEnv } from "@/lib/env";
import { ACCION_DE_TIPO, ACCIONES } from "@/lib/workflows/catalogo";
import type { AppClient } from "@/server/db/client";
import { correrPrueba, sesionSimulada } from "@/server/services/workflows/simulador.service";
import type { Lead } from "@/types/entities";
import {
  NODO_TIPOS,
  esCondicion,
  esEspera,
  esFinal,
  esSalto,
  esSwitch,
  esTrigger,
  type Grafo,
  type Nodo,
  type NodoTipo,
} from "@/types/workflows";
import { cargaPesada } from "../../helpers/carga-pesada";

/**
 * Fase 0 del PRD de workflows (§12, criterio de §13): "Probar ejecuta el mismo
 * motor que producción. Un test falla si reaparecen dos registros."
 *
 * Había dos: `lib/workflows/engine/handlers/` (57 handlers que no ejecutaban
 * nada, los usaba el botón Probar) y el de producción (4 acciones). Cada mitad
 * se testeaba contra sí misma y la suite pasaba igual. Este archivo mira las
 * dos cosas que la suite anterior no miraba: el código de `src/` y el camino
 * real que recorre cada uno.
 */

const RAIZ = join(__dirname, "..", "..", "..");
const SRC = join(RAIZ, "src");
const REGISTRO = "src/server/services/workflows/acciones/registro.ts";

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivosTs(ruta));
    else if (/\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

function rutaRelativa(archivo: string): string {
  return relative(RAIZ, archivo).split(sep).join("/");
}

/**
 * Los `.ts/.tsx` de `src/`, leídos una sola vez para los dos tests que los
 * revisan. Leerlos es lo caro del archivo: con la máquina cargada pasó los 5 s
 * del timeout por defecto (medición en `carga-pesada.ts`).
 */
const fuentesDeSrc = cargaPesada(() =>
  archivosTs(SRC).map((archivo) => ({
    rel: rutaRelativa(archivo),
    texto: readFileSync(archivo, "utf8"),
  })),
);

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

function testEnv(): AppEnv {
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
    META_GRAPH_API_VERSION: "v21.0",
    META_IG_PAGE_ID: undefined,
    META_IG_ACCESS_TOKEN: undefined,
    META_FB_PAGE_ID: undefined,
    META_FB_PAGE_ACCESS_TOKEN: undefined,
    LLM_DAILY_CAP_USD: 10,
    LLM_MODE: "mock",
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  };
}

/** El registro que usa `workflow-segmento` en producción, armado por el bootstrap real. */
function registroDeProduccion() {
  const { deps } = makeInngestDeps({
    env: testEnv(),
    db: {} as AppClient,
    inngest: { send: vi.fn() } as unknown as CrmInngestClient,
  });
  return deps.workflowSegmento.registro;
}

const LEAD: Lead = {
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
  created_at: new Date(),
  updated_at: new Date(),
};

/** El motor resuelve el control de flujo; todo lo demás es una acción del registro. */
// Las cuatro esperas —incluidas "esperar respuesta" y "esperar evento"—,
// "Según el valor" e "Ir a" las resuelve el ejecutor, no el registro: nunca
// llegan a una acción.
function esControlDeFlujo(tipo: NodoTipo): boolean {
  return (
    esTrigger(tipo) ||
    esFinal(tipo) ||
    esCondicion(tipo) ||
    esEspera(tipo) ||
    esSwitch(tipo) ||
    esSalto(tipo)
  );
}

describe("un solo registro de acciones", () => {
  it("no existe el segundo intérprete de lib/workflows/engine", () => {
    expect(existsSync(join(SRC, "lib", "workflows", "engine"))).toBe(false);
  });

  it("ningún módulo de src/ arma un registro de acciones fuera de acciones/registro.ts", () => {
    const patrones = [
      // El registro global mutable de `engine/handlers/registro.ts`.
      /\bregistrarHandler\s*\(/,
      /\bobtenerHandler\s*\(/,
      // El despachador: en src/ sólo lo llama `crearRegistroDeAcciones`.
      /\bcrearRegistro\s*\(/,
      // Un registro armado a mano (el simulador viejo aceptaba cualquier acción).
      /:\s*RegistroDeAcciones\s*=\s*\{/,
      /implements\s+RegistroDeAcciones\b/,
    ];
    const infractores: string[] = [];
    for (const { rel, texto } of fuentesDeSrc()) {
      if (rel === REGISTRO) continue;
      for (const patron of patrones) {
        if (patron.test(texto)) infractores.push(`${rel} ~ ${patron.source}`);
      }
    }
    expect(infractores).toEqual([]);
  });

  it("producción y Probar construyen su registro con la misma fábrica", () => {
    const usos = fuentesDeSrc()
      .filter(({ texto }) => /\bcrearRegistroDeAcciones\s*\(/.test(texto))
      .map(({ rel }) => rel)
      .sort();
    expect(usos).toEqual([
      // producción
      "src/inngest/bootstrap.ts",
      // la definición
      REGISTRO,
      // "Probar" y el simulador (`correrPrueba`)
      "src/server/services/workflows/simulador.service.ts",
    ]);
  });

  it("las acciones del catálogo que ve la UI son exactamente las que ejecuta producción", () => {
    const prod = registroDeProduccion();
    for (const accion of ACCIONES) {
      expect(prod.soporta(nodo("a", "accion", { accion })), accion).toBe(true);
    }
    expect(prod.soporta(nodo("a", "accion", { accion: "inventada" }))).toBe(false);
    for (const [tipo, accion] of Object.entries(ACCION_DE_TIPO)) {
      expect(ACCIONES as readonly string[]).toContain(accion);
      expect(prod.soporta(nodo("n", tipo as NodoTipo)), tipo).toBe(true);
    }
  });

  it("Probar rechaza exactamente los tipos de nodo que producción no sabe ejecutar", async () => {
    const prod = registroDeProduccion();
    const divergencias: string[] = [];

    for (const tipo of NODO_TIPOS) {
      if (esControlDeFlujo(tipo) || tipo === "accion") continue;
      const grafo: Grafo = {
        nodos: [nodo("t", "trigger_manual"), nodo("x", tipo), nodo("fin", "logica_detener")],
        aristas: [
          { desde: "t", hasta: "x", puerto: "salida" },
          { desde: "x", hasta: "fin", puerto: "salida" },
        ],
      };
      // El camino real de "Probar": `correrPrueba`, con su registro.
      const r = await correrPrueba({
        grafo,
        maxPasos: 10,
        desde: new Date("2026-09-13T12:00:00Z"),
        contexto: {},
        lead: LEAD,
        sesion: sesionSimulada(LEAD.id, new Date("2026-09-13T12:00:00Z")),
        runId: "prueba",
      });
      const probarLoRechaza = r.error?.includes("no sabe ejecutar") ?? false;
      const produccionLoRechaza = !prod.soporta(nodo("x", tipo));
      if (probarLoRechaza !== produccionLoRechaza) {
        divergencias.push(`${tipo}: probar=${probarLoRechaza} produccion=${produccionLoRechaza}`);
      }
    }

    expect(divergencias).toEqual([]);
  });
});
