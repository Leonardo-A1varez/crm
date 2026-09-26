import { describe, expect, it } from "vitest";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { DefaultCorridasWorkflowService } from "@/server/services/workflows/corridas.service";
import type { LeadVehiculo, Mensaje, WorkflowVersion } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

// Fixtures armados a mano para estos tests: no salen de ningún dato real.
const GRAFO: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    { id: "m", tipo: "msg_texto", config: { mensaje: "hola" }, posicion: { x: 0, y: 1 } },
    { id: "e", tipo: "crm_etiqueta_add", config: {}, posicion: { x: 0, y: 2 } },
    { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 3 } },
  ],
  aristas: [
    { desde: "t", hasta: "m", puerto: "salida" },
    { desde: "m", hasta: "e", puerto: "salida" },
    { desde: "e", hasta: "fin", puerto: "salida" },
  ],
};

const VERSION: WorkflowVersion = {
  id: "v1",
  workflow_id: "w1",
  version: 3,
  grafo: GRAFO,
  max_pasos: 50,
  publicada: true,
  created_at: new Date("2026-09-01T00:00:00Z"),
  created_by: null,
  politica_concurrencia: "ignorar",
  nota: null,
} as WorkflowVersion;

function vehiculo(over: Partial<LeadVehiculo>): LeadVehiculo {
  return {
    id: "veh",
    lead_id: "l1",
    marca: null,
    modelo: null,
    anio: null,
    motor: null,
    placa: null,
    placa_original: null,
    vin: null,
    vin_original: null,
    principal: false,
    created_at: new Date("2026-09-01T00:00:00Z"),
    ...over,
  };
}

async function montar(opts: { vehiculos?: LeadVehiculo[]; prueba?: boolean } = {}) {
  const runs = new InMemoryWorkflowRunsRepository(() => "w1");
  const { run } = await runs.arrancar({
    versionId: "v1",
    leadId: "l1",
    sessionId: null,
    contexto: opts.prueba ? { $prueba: true } : {},
  });
  const runId = run!.id;
  await runs.registrarPaso(runId, {
    nodo_id: "t",
    orden: 1,
    entrada: null,
    salida: null,
    error: null,
  });
  await runs.registrarPaso(runId, {
    nodo_id: "m",
    orden: 2,
    entrada: null,
    salida: opts.prueba
      ? { simulado: [{ accion: "enviar_mensaje", detalle: { texto: "hola Ana" }, en: "x" }] }
      : { mensaje_id: "msg-1" },
    error: null,
  });
  await runs.registrarPaso(runId, {
    nodo_id: "e",
    orden: 3,
    entrada: null,
    salida: null,
    error: null,
  });
  const mensajes = new Map<string, Mensaje>([
    [
      `wf:${runId}:2`,
      {
        id: "msg-1",
        contenido: "hola Ana",
        estado_entrega: "entregado",
        created_at: new Date("2026-09-25T12:00:00Z"),
      } as Mensaje,
    ],
  ]);
  const svc = new DefaultCorridasWorkflowService({
    workflows: {
      findVersion: async () => VERSION,
      findWorkflow: async () => ({ id: "w1", nombre: "Bienvenida" }) as never,
    },
    runs,
    leads: { findById: async () => ({ nombre: "Ana", nombre_perfil: null }) as never },
    messages: {
      findById: async () => null,
      findByIdempotencyKey: async (k) => mensajes.get(k) ?? null,
    },
    vehiculos: { listByLeadId: async () => opts.vehiculos ?? [] },
    emitirSegmento: async () => {},
    emitirCancelacion: async () => {},
    audit: { recordAction: async () => ({}) as never },
  });
  return { svc, runId };
}

describe("la vista de una corrida: vehículo, mensajes y corridas por nodo", () => {
  it("el vehículo es el principal, dicho como modelo y año", async () => {
    const { svc, runId } = await montar({
      vehiculos: [
        vehiculo({ id: "a", marca: "Toyota", modelo: "Hilux", anio: 2018, principal: true }),
        vehiculo({ id: "b", marca: "Ford", modelo: "Ranger", anio: 2016 }),
      ],
    });
    expect((await svc.vista(runId))?.lead.vehiculo).toBe("Hilux 2018");
  });

  it("sin modelo cae a la marca; sin vehículo, null", async () => {
    const m = await montar({ vehiculos: [vehiculo({ marca: "Fiat" })] });
    expect((await m.svc.vista(m.runId))?.lead.vehiculo).toBe("Fiat");
    const sin = await montar();
    expect((await sin.svc.vista(sin.runId))?.lead.vehiculo).toBeNull();
  });

  it("los mensajes que mandó la corrida se buscan por su clave wf:<runId>:<orden>", async () => {
    const { svc, runId } = await montar();
    expect((await svc.vista(runId))?.mensajes).toEqual([
      {
        nodoId: "m",
        orden: 2,
        texto: "hola Ana",
        estado: "entregado",
        at: new Date("2026-09-25T12:00:00Z"),
        simulado: false,
      },
    ]);
  });

  it("una corrida de Probar no mandó nada: muestra lo que habría mandado, marcado", async () => {
    const { svc, runId } = await montar({ prueba: true });
    expect((await svc.vista(runId))?.mensajes).toEqual([
      {
        nodoId: "m",
        orden: 2,
        texto: "hola Ana",
        estado: null,
        at: expect.any(Date),
        simulado: true,
      },
    ]);
  });

  it("cuenta por dónde pasaron las corridas de la versión", async () => {
    const { svc, runId } = await montar();
    expect((await svc.vista(runId))?.porNodo).toEqual({
      corridas: 1,
      vivas: 1,
      nodos: [
        { nodoId: "e", corridas: 1, fallaron: 0, esperando: 0 },
        { nodoId: "m", corridas: 1, fallaron: 0, esperando: 0 },
        { nodoId: "t", corridas: 1, fallaron: 0, esperando: 0 },
      ],
    });
  });
});
