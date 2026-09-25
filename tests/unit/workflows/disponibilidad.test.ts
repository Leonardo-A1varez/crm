import { describe, expect, it, vi } from "vitest";
import type { CrmInngestClient } from "@/inngest/client";
import { makeInngestDeps } from "@/inngest/bootstrap";
import type { AppEnv } from "@/lib/env";
import { ACCION_DE_TIPO, DISPARADOR_DE_TIPO } from "@/lib/workflows/catalogo";
import {
  NO_DISPONIBLES,
  clasificarTipo,
  disponibilidadDeTipo,
} from "@/lib/workflows/disponibilidad";
import { CATEGORIAS_NODOS } from "@/lib/workflows/nodos-catalogo";
import { problemasParaPublicar } from "@/lib/workflows/validar-workflow";
import type { AppClient } from "@/server/db/client";
import { NODO_TIPOS, esTrigger, type Grafo, type Nodo, type NodoTipo } from "@/types/workflows";

/**
 * Una sola respuesta a "¿este bloque se puede ejecutar?", y la misma en los
 * tres lados: la paleta del editor, el validador de publicación y el motor.
 *
 * Antes la paleta ofrecía 57 bloques y el motor sabía ejecutar 3: un flujo con
 * "Asignar vendedor" se publicaba y fallaba al correr.
 */

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
    LLM_DAILY_CAP_USD: 10,
    LLM_MODE: "mock",
  };
}

function registroDeProduccion() {
  const { deps } = makeInngestDeps({
    env: testEnv(),
    db: {} as AppClient,
    inngest: { send: vi.fn() } as unknown as CrmInngestClient,
  });
  return deps.workflowSegmento.registro;
}

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

describe("disponibilidad de los bloques", () => {
  it("todo tipo de nodo tiene una clasificación: nadie queda sin decidir", () => {
    // Un tipo nuevo en el catálogo sin handler y sin marca de "no disponible"
    // cae acá. Agregarlo obliga a elegir: o se le escribe el handler, o se lo
    // marca en `NO_DISPONIBLES` con el motivo.
    const sinClasificar = NODO_TIPOS.filter((t) => clasificarTipo(t) === "sin_clasificar");
    expect(sinClasificar).toEqual([]);
  });

  it("cada tipo ejecutable como acción lo ejecuta el registro de producción", () => {
    const prod = registroDeProduccion();
    // El legacy `accion` depende de `config.accion`: lo cubre
    // `registro-unico.test.ts` acción por acción.
    const faltan = NODO_TIPOS.filter(
      (t) => t !== "accion" && clasificarTipo(t) === "accion" && !prod.soporta(nodo("x", t)),
    );
    expect(faltan).toEqual([]);
  });

  it("ninguna marca de «no disponible» miente: el motor no lo ejecuta de verdad", () => {
    const prod = registroDeProduccion();
    const mienten = (Object.keys(NO_DISPONIBLES) as NodoTipo[]).filter(
      (t) =>
        prod.soporta(nodo("x", t)) ||
        Object.hasOwn(ACCION_DE_TIPO, t) ||
        Object.hasOwn(DISPARADOR_DE_TIPO, t),
    );
    expect(mienten).toEqual([]);
  });

  it("un disparador está disponible si y sólo si algo lo emite", () => {
    for (const t of NODO_TIPOS.filter((x) => esTrigger(x) && x !== "disparador")) {
      expect(disponibilidadDeTipo(t).disponible, t).toBe(Object.hasOwn(DISPARADOR_DE_TIPO, t));
    }
  });

  it("todo motivo es una frase para una persona, no un código", () => {
    for (const [tipo, motivo] of Object.entries(NO_DISPONIBLES)) {
      expect(motivo.trim().length, tipo).toBeGreaterThan(20);
      expect(motivo, tipo).toMatch(/\.$/);
    }
  });

  it("la paleta no ofrece un tipo que el dominio no conoce", () => {
    const tipos = new Set<string>(NODO_TIPOS);
    const desconocidos = CATEGORIAS_NODOS.flatMap((c) => c.nodos.map((n) => n.tipo)).filter(
      (t) => !tipos.has(t),
    );
    expect(desconocidos).toEqual([]);
  });
});

describe("el validador de publicación rechaza lo que no se puede ejecutar", () => {
  function grafoCon(x: Nodo): Grafo {
    return {
      nodos: [nodo("t", "trigger_manual"), x, nodo("fin", "logica_detener")],
      aristas: [
        { desde: "t", hasta: x.id, puerto: "salida" },
        { desde: x.id, hasta: "fin", puerto: "salida" },
      ],
    };
  }

  it("nombra el bloque y dice por qué", () => {
    const [tipo, motivo] = Object.entries(NO_DISPONIBLES)[0] as [NodoTipo, string];
    const problemas = problemasParaPublicar(grafoCon(nodo("x", tipo)));
    expect(problemas).toContainEqual({ nodoId: "x", mensaje: expect.stringContaining(motivo) });
  });

  it("no suma errores de configuración sobre un bloque que igual no corre", () => {
    // Pedirle la URL a un "HTTP Request" que el motor no ejecuta manda a quien
    // arma el flujo a completar un campo que no sirve de nada.
    const problemas = problemasParaPublicar(grafoCon(nodo("x", "int_http")));
    expect(problemas.filter((p) => p.nodoId === "x")).toHaveLength(1);
  });

  it("un bloque ejecutable bien configurado se publica", () => {
    const problemas = problemasParaPublicar(
      grafoCon(nodo("x", "crm_etiqueta_add", { tagIds: ["t1"] })),
    );
    expect(problemas).toEqual([]);
  });
});
