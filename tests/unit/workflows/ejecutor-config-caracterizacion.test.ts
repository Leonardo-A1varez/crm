import { describe, expect, it, vi } from "vitest";
import { armarPlantilla } from "@/app/(panel)/workflows/nuevo/_lib/grafos-plantillas";
import { ejecutarSegmento } from "@/server/services/workflows/ejecutor.service";
import type { PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import type { RegistroDeAcciones } from "@/server/services/workflows/acciones/registro";
import type { ContextoRun, Grafo, Nodo, NodoTipo } from "@/types/workflows";

/**
 * Caracterización de cómo el ejecutor lee la config de las esperas y de la
 * condición. Fija el resultado con las configs que existen de verdad:
 *
 * - las que escribe el panel (`ConfigLogica.tsx` vía `editorDeConfig`, que
 *   guarda sólo lo que se tocó);
 * - las dos guardadas en `crm-dev` (leídas el 2026-09-25 con
 *   `select n->'config' from workflow_versiones, jsonb_array_elements(grafo->'nodos') n
 *   where n->>'tipo' in ('espera','logica_esperar',...,'logica_condicion')`);
 * - las de las plantillas (`grafos-plantillas.ts`, leídas del módulo real);
 * - las de claves ausentes o nulas.
 *
 * Una fila que cambia de resultado es un cambio de comportamiento: la
 * diferencia se anota junto a la fila.
 */

const AHORA = new Date("2026-09-25T12:00:00Z");
const SEG = 1_000;
const MIN = 60 * SEG;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

const registroQueNoSeUsa: RegistroDeAcciones = {
  soporta: () => true,
  ejecutar: () => Promise.reject(new Error("una espera o una condición no pasan por el registro")),
};

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown>): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

type Resumen =
  | { espera: number }
  | { falla: string; error: string }
  | { rama: "verdadero" | "falso" };

async function correr(grafo: Grafo, desde: string, contexto: ContextoRun = {}): Promise<Resumen> {
  const pasos: PasoEjecutado[] = [];
  const r = await ejecutarSegmento(
    {
      grafo,
      desdeNodo: desde,
      contexto,
      leadId: "l1",
      runId: "r1",
      pasosPrevios: 0,
      maxPasos: 50,
    },
    {
      registro: registroQueNoSeUsa,
      ahora: () => AHORA,
      onPaso: vi.fn(async (p: PasoEjecutado) => {
        pasos.push(p);
      }),
    },
  );
  if (r.tipo === "espera") return { espera: r.hasta.getTime() - AHORA.getTime() };
  if (r.tipo === "fallado") return { falla: r.motivo, error: r.error };
  const ultimo = pasos.at(-1)?.nodoId;
  return { rama: ultimo === "si" ? "verdadero" : "falso" };
}

function esperaSola(tipo: NodoTipo, config: Record<string, unknown>): Promise<Resumen> {
  return correr(
    {
      nodos: [nodo("w", tipo, config), nodo("f", "fin", {})],
      aristas: [{ desde: "w", hasta: "f", puerto: "salida" }],
    },
    "w",
  );
}

function condicionSola(config: Record<string, unknown>, contexto: ContextoRun): Promise<Resumen> {
  return correr(
    {
      nodos: [nodo("c", "logica_condicion", config), nodo("si", "fin", {}), nodo("no", "fin", {})],
      aristas: [
        { desde: "c", hasta: "si", puerto: "verdadero" },
        { desde: "c", hasta: "no", puerto: "falso" },
      ],
    },
    "c",
    contexto,
  );
}

describe("caracterización — espera legacy (`espera`, lee `minutos`)", () => {
  it.each<[string, Record<string, unknown>, Resumen]>([
    ["la de los fixtures: 60", { minutos: 60 }, { espera: 60 * MIN }],
    ["sin config: 60 minutos", {}, { espera: 60 * MIN }],
    ["5 minutos", { minutos: 5 }, { espera: 5 * MIN }],
  ])("%s", async (_caso, config, esperado) => {
    expect(await esperaSola("espera", config)).toEqual(esperado);
  });

  // CAMBIO DE COMPORTAMIENTO (2026-09-25). Antes el ejecutor cambiaba cualquier
  // `minutos` que no fuera un número positivo por 60, callado; ahora lee con el
  // schema (`minutos` positivo, default 60 sólo si falta) y falla en voz alta,
  // igual que `logica_esperar` con una duración inválida. El panel no tiene
  // formulario para este tipo legacy y crm-dev no guarda ninguno.
  it.each<[string, Record<string, unknown>]>([
    ["minutos 0 (antes: 60)", { minutos: 0 }],
    ["minutos negativo (antes: 60)", { minutos: -3 }],
    ["minutos como texto (antes: 60)", { minutos: "30" }],
    ["minutos null (antes: 60)", { minutos: null }],
  ])("%s falla con grafo_invalido", async (_caso, config) => {
    expect(await esperaSola("espera", config)).toMatchObject({ falla: "grafo_invalido" });
  });
});

describe("caracterización — esperar tiempo (`logica_esperar`)", () => {
  it.each<[string, Record<string, unknown>, Resumen]>([
    // Guardada en crm-dev (versión publicada).
    ["crm-dev: 5 segundos", { unidad: "segundos", duracion: 5 }, { espera: 5 * SEG }],
    // Panel: el nodo recién soltado no escribe nada y muestra 1 hora.
    ["panel sin tocar: 1 hora", {}, { espera: 1 * HORA }],
    ["panel, sólo la duración: 3 horas", { duracion: 3 }, { espera: 3 * HORA }],
    ["panel, sólo la unidad: 1 día", { unidad: "dias" }, { espera: 1 * DIA }],
    ["panel, 2 minutos", { duracion: 2, unidad: "minutos" }, { espera: 2 * MIN }],
    ["fracción: 1,5 horas", { duracion: 1.5, unidad: "horas" }, { espera: 1.5 * HORA }],
  ])("%s", async (_caso, config, esperado) => {
    expect(await esperaSola("logica_esperar", config)).toEqual(esperado);
  });

  it.each<[string, Record<string, unknown>]>([
    // `Number("")` del input vacío del panel.
    ["duración 0", { duracion: 0, unidad: "horas" }],
    ["duración negativa", { duracion: -2, unidad: "horas" }],
    ["duración como texto", { duracion: "5", unidad: "horas" }],
    ["unidad que no existe", { duracion: 5, unidad: "semanas" }],
    // CAMBIO DE COMPORTAMIENTO (2026-09-25). Antes `?? 1` y `?? "horas"`
    // convertían un null en 1 hora. El panel no muestra eso: dibuja
    // `Number(null)` = 0 en la duración y ninguna unidad elegida, y el
    // validador ya rechazaba publicarlo. Gana lo que muestra el panel.
    ["duración null (antes: 1 hora)", { duracion: null, unidad: "horas" }],
    ["unidad null (antes: horas)", { duracion: 2, unidad: null }],
  ])("%s falla con grafo_invalido", async (_caso, config) => {
    expect(await esperaSola("logica_esperar", config)).toMatchObject({ falla: "grafo_invalido" });
  });

  it("las dos esperas de la plantilla «seguimiento de cotización»: 24 y 48 horas", async () => {
    const plantilla = armarPlantilla("seguimiento-cotizacion");
    const esperas = plantilla?.grafo.nodos.filter((n) => n.tipo === "logica_esperar") ?? [];
    expect(esperas).toHaveLength(2);
    const resultados = await Promise.all(esperas.map((n) => esperaSola(n.tipo, n.config)));
    expect(resultados).toEqual([{ espera: 24 * HORA }, { espera: 48 * HORA }]);
  });
});

describe("caracterización — esperar respuesta / esperar evento", () => {
  it.each<[string, NodoTipo, Record<string, unknown>, Resumen]>([
    ["respuesta sin tocar: 24 horas", "logica_esperar_respuesta", {}, { espera: 24 * HORA }],
    [
      "respuesta, 30 minutos",
      "logica_esperar_respuesta",
      { timeout: 30, unidadTimeout: "minutos" },
      { espera: 30 * MIN },
    ],
    [
      "evento sin tocar el tiempo: 7 días",
      "logica_esperar_evento",
      { evento: "etiqueta_asignada" },
      { espera: 7 * DIA },
    ],
    [
      "evento, 12 horas",
      "logica_esperar_evento",
      { evento: "etapa_cambiada", timeoutMax: 12, unidadTimeoutMax: "horas" },
      { espera: 12 * HORA },
    ],
  ])("%s", async (_caso, tipo, config, esperado) => {
    expect(await esperaSola(tipo, config)).toEqual(esperado);
  });

  it.each<[string, NodoTipo, Record<string, unknown>, string]>([
    [
      "respuesta con tiempo 0",
      "logica_esperar_respuesta",
      { timeout: 0 },
      'la espera de respuesta "w" no tiene un tiempo máximo válido: 0',
    ],
    [
      "evento sin elegir",
      "logica_esperar_evento",
      {},
      'la espera de evento "w": Elegí qué evento esperar',
    ],
    [
      "evento con tiempo negativo",
      "logica_esperar_evento",
      { evento: "etapa_cambiada", timeoutMax: -1 },
      'la espera de evento "w" no tiene un tiempo máximo válido: -1',
    ],
  ])("%s falla con el mensaje de siempre", async (_caso, tipo, config, error) => {
    expect(await esperaSola(tipo, config)).toEqual({ falla: "grafo_invalido", error });
  });
});

describe("caracterización — condición (`logica_condicion`, lee `operador` y `valor`)", () => {
  it.each<[string, Record<string, unknown>, ContextoRun, Resumen]>([
    // Guardada en crm-dev (versión publicada).
    [
      "crm-dev: lead.etapa es nuevo, con etapa nuevo",
      { campo: "lead.etapa", valor: "nuevo", operador: "es" },
      { lead: { etapa: "nuevo" } },
      { rama: "verdadero" },
    ],
    [
      "crm-dev: lead.etapa es nuevo, con etapa cotizado",
      { campo: "lead.etapa", valor: "nuevo", operador: "es" },
      { lead: { etapa: "cotizado" } },
      { rama: "falso" },
    ],
    // Panel: sólo se eligió el campo y el valor; el operador se ve "es".
    [
      "sin operador guardado vale «es»",
      { campo: "lead.etapa", valor: "cotizado" },
      { lead: { etapa: "cotizado" } },
      { rama: "verdadero" },
    ],
    [
      "operador null vale «es»",
      { campo: "lead.etapa", operador: null, valor: "cotizado" },
      { lead: { etapa: "cotizado" } },
      { rama: "verdadero" },
    ],
  ])("%s", async (_caso, config, contexto, esperado) => {
    expect(await condicionSola(config, contexto)).toEqual(esperado);
  });

  it("la condición recién soltada (config vacía) falla con el mismo mensaje", async () => {
    expect(await condicionSola({}, {})).toEqual({
      falla: "condicion_invalida",
      error: expect.stringMatching(/^la condición "c" está mal configurada: campo: /) as string,
    });
  });

  it("plantillas: «no respondió» y «reactivar perdidos» eligen la misma rama que antes", async () => {
    const seguimiento = armarPlantilla("seguimiento-cotizacion")?.grafo.nodos.find(
      (n) => n.tipo === "logica_condicion",
    );
    const reactivar = armarPlantilla("reactivar-perdidos")?.grafo.nodos.find(
      (n) => n.tipo === "logica_condicion",
    );
    expect(seguimiento && reactivar).toBeTruthy();
    expect(await condicionSola(seguimiento!.config, { sesion: { respondio: false } })).toEqual({
      rama: "verdadero",
    });
    expect(await condicionSola(seguimiento!.config, { sesion: { respondio: true } })).toEqual({
      rama: "falso",
    });
    expect(await condicionSola(reactivar!.config, { lead: { etapa: "perdido" } })).toEqual({
      rama: "verdadero",
    });
  });
});
