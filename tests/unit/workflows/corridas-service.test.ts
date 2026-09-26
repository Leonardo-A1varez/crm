import { describe, expect, it } from "vitest";
import {
  ConflictError,
  IllegalStateError,
  InfraError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { segmentoHandler } from "@/inngest/functions/workflow-segmento";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { crearRegistro, type AccionHandler } from "@/server/services/workflows/acciones/registro";
import {
  DefaultCorridasWorkflowService,
  type EventoSegmento,
} from "@/server/services/workflows/corridas.service";
import type { Mensaje, UUID } from "@/types/entities";
import { MARCA_CORRIDA_DE_PRUEBA, type Grafo } from "@/types/workflows";

// Grafos, lead y mensajes armados a mano para estos tests: no salen de ningún dato real.

/** disparador -> a -> m -> fin. `a` y `m` son acciones legacy, para contar cuántas veces corren. */
const GRAFO: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    { id: "a", tipo: "accion", config: { accion: "anotar" }, posicion: { x: 1, y: 0 } },
    { id: "m", tipo: "accion", config: { accion: "avisar" }, posicion: { x: 2, y: 0 } },
    { id: "fin", tipo: "fin", config: {}, posicion: { x: 3, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "a", puerto: "salida" },
    { desde: "a", hasta: "m", puerto: "salida" },
    { desde: "m", hasta: "fin", puerto: "salida" },
  ],
};

/** disparador -> s (enviar mensaje) -> m -> fin. */
const GRAFO_CON_ENVIO: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    { id: "s", tipo: "msg_texto", config: { mensaje: "hola" }, posicion: { x: 1, y: 0 } },
    { id: "m", tipo: "accion", config: { accion: "avisar" }, posicion: { x: 2, y: 0 } },
    { id: "fin", tipo: "fin", config: {}, posicion: { x: 3, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "s", puerto: "salida" },
    { desde: "s", hasta: "m", puerto: "salida" },
    { desde: "m", hasta: "fin", puerto: "salida" },
  ],
};

const AHORA = new Date("2026-09-13T15:00:00Z");

function mensaje(id: UUID, contenido: string): Mensaje {
  return {
    id,
    conversacion_id: "conv-1",
    lead_session_id: "sesion-1",
    direction: "out",
    sender: "sistema",
    sender_user_id: null,
    tipo: "text",
    contenido,
    media_url: null,
    meta_message_id: "wamid.x",
    idempotency_key: null,
    metadata: {},
    created_at: AHORA,
    platform_created_at: null,
    estado_entrega: null,
    estado_entrega_at: null,
    error_entrega: null,
  };
}

async function escenario() {
  const workflows = new InMemoryWorkflowsRepository();
  const w = await workflows.crearWorkflow({
    nombre: "Seguimiento",
    descripcion: null,
    activo: true,
  });
  const v = await workflows.crearVersion({
    workflow_id: w.id,
    version: 1,
    grafo: GRAFO,
    max_pasos: 50,
    created_by: null,
  });
  const vEnvio = await workflows.crearVersion({
    workflow_id: w.id,
    version: 2,
    grafo: GRAFO_CON_ENVIO,
    max_pasos: 50,
    created_by: null,
  });
  const runs = new InMemoryWorkflowRunsRepository(
    (versionId) => (versionId === v.id || versionId === vEnvio.id ? w.id : undefined),
    () => ({ maxPasos: 50, politica: "ignorar" }),
  );
  const leads = new InMemoryLeadsRepository();
  const lead = await leads.create({
    nombre: "Juan Pérez",
    telefono: "+5491100000000",
    email: null,
    direccion: null,
    vehiculo_marca: null,
    vehiculo_modelo: null,
    vehiculo_anio: null,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: {},
  });
  const mensajes = new Map<string, Mensaje>();
  const emitidos: EventoSegmento[] = [];
  const llamadas = { anotar: 0, avisar: 0 };
  let emisionCaida = false;

  const service = new DefaultCorridasWorkflowService({
    workflows,
    runs,
    leads,
    vehiculos: { listByLeadId: async () => [] },
    messages: {
      findById: async (id) => mensajes.get(id) ?? null,
      findByIdempotencyKey: async (clave) =>
        [...mensajes.values()].find((m) => m.idempotency_key === clave) ?? null,
    },
    emitirSegmento: async (evento) => {
      if (emisionCaida) throw new Error("Inngest no responde");
      emitidos.push(evento);
    },
    nuevoId: () => "id-fijo",
    emitirCancelacion: async () => {},
    audit: { recordAction: async () => ({}) as never },
  });

  const anotar: AccionHandler = async () => {
    llamadas.anotar += 1;
    return { puerto: "salida", salida: { anotado: true } };
  };

  return {
    workflows,
    w,
    v,
    vEnvio,
    runs,
    lead,
    mensajes,
    emitidos,
    llamadas,
    service,
    anotar,
    caerEmision: () => {
      emisionCaida = true;
    },
  };
}

type Escenario = Awaited<ReturnType<typeof escenario>>;

/** Lo que haría Inngest con un evento de segmento: el mismo handler de producción. */
function correrSegmento(ctx: Escenario, runId: UUID, desdePaso: number, avisar: AccionHandler) {
  return segmentoHandler(
    { runId, desdePaso },
    {
      runs: ctx.runs,
      workflows: ctx.workflows,
      registro: crearRegistro({ anotar: ctx.anotar, avisar }),
      ahora: () => AHORA,
    },
  );
}

const avisarFalla: AccionHandler = async () => {
  throw new ValidationError("la ventana de 24 h de Meta está cerrada", "ventana_24h_meta_cerrada");
};

/**
 * Una corrida que falla en `m` en su PRIMER segmento: `nodo_actual` queda en
 * null, que el motor lee como "desde el disparador". Es el caso en que un
 * reanudar ingenuo volvería a empezar.
 */
async function falladaEnM(ctx: Escenario, contexto: Record<string, unknown> = {}) {
  const { run } = await ctx.runs.arrancar({
    versionId: ctx.v.id,
    leadId: ctx.lead.id,
    sessionId: null,
    contexto,
  });
  const r = await correrSegmento(ctx, run!.id, 0, avisarFalla);
  expect(r).toMatchObject({ tipo: "fallado", nodoId: "m" });
  const fallada = await ctx.runs.findRun(run!.id);
  expect(fallada?.nodo_actual).toBeNull();
  return fallada!;
}

describe("vista — lo que pinta CorridaEnVivo", () => {
  it("una corrida que no existe: null", async () => {
    const ctx = await escenario();
    expect(await ctx.service.vista("00000000-0000-4000-8000-000000000999")).toBeNull();
  });

  it("una corrida fallada: el estado de cada nodo, la previa de reanudar y la de empezar de nuevo", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx);

    const vista = await ctx.service.vista(run.id);

    expect(vista?.workflow).toEqual({ id: ctx.w.id, nombre: "Seguimiento" });
    expect(vista?.version).toMatchObject({ id: ctx.v.id, numero: 1, maxPasos: 50, grafo: GRAFO });
    expect(vista?.lead).toEqual({ id: ctx.lead.id, nombre: "Juan Pérez", vehiculo: null });
    expect(vista?.esPrueba).toBe(false);
    expect(vista?.pasos.map((p) => p.nodo_id)).toEqual(["t", "a", "m"]);
    expect(vista?.nodos.map((n) => [n.nodoId, n.estado, n.ejecuciones])).toEqual([
      ["t", "completado", 1],
      ["a", "completado", 1],
      ["m", "fallado", 1],
      ["fin", "pendiente", 0],
    ]);
    expect(vista?.reanudar).toEqual({
      posible: true,
      desdeNodo: "m",
      desdePaso: 3,
      reusados: [
        { nodoId: "t", orden: 1, at: expect.any(Date) },
        { nodoId: "a", orden: 2, at: expect.any(Date) },
      ],
      reejecuta: [
        { nodoId: "m", ordenFallado: 3, error: "la ventana de 24 h de Meta está cerrada" },
      ],
    });
    expect(vista?.ejecutarDeNuevo).toEqual({
      posible: true,
      destinatario: { leadId: ctx.lead.id, nombre: "Juan Pérez" },
      envios: [],
    });
  });

  it("empezar de nuevo enumera cada mensaje que ya salió, con su texto; no los diferidos", async () => {
    const ctx = await escenario();
    ctx.mensajes.set("msg-1", mensaje("msg-1", "hola Juan"));
    const { run } = await ctx.runs.arrancar({
      versionId: ctx.vEnvio.id,
      leadId: ctx.lead.id,
      sessionId: null,
      contexto: {},
    });
    const paso = (
      nodo_id: string,
      orden: number,
      salida: Record<string, unknown> | null,
      error: string | null = null,
    ) => ctx.runs.registrarPaso(run!.id, { nodo_id, orden, entrada: null, salida, error });
    await paso("t", 1, null);
    // Fuera de horario: el envío se difirió y NO salió.
    await paso("s", 2, { diferido_hasta: "2026-09-14T12:00:00.000Z" });
    await paso("s", 3, { mensaje_id: "msg-1" });
    await paso("m", 4, null, "boom");
    await ctx.runs.fallar(run!.id, "boom", 4);

    const vista = await ctx.service.vista(run!.id);

    expect(vista?.ejecutarDeNuevo).toEqual({
      posible: true,
      destinatario: { leadId: ctx.lead.id, nombre: "Juan Pérez" },
      envios: [
        {
          nodoId: "s",
          orden: 3,
          enviadoAt: expect.any(Date),
          mensajeId: "msg-1",
          texto: "hola Juan",
        },
      ],
    });
    // Un nodo que corrió dos veces cuenta sus dos ejecuciones y muestra la última.
    expect(vista?.nodos.find((n) => n.nodoId === "s")).toMatchObject({
      estado: "completado",
      ejecuciones: 2,
      ultima: { orden: 3, salida: { mensaje_id: "msg-1" }, error: null },
    });
  });

  it("una corrida de Probar no ofrece ni reanudar ni empezar de nuevo", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx, { [MARCA_CORRIDA_DE_PRUEBA]: true });

    const vista = await ctx.service.vista(run.id);

    expect(vista?.esPrueba).toBe(true);
    expect(vista?.reanudar).toEqual({ posible: false, motivo: "corrida_de_prueba" });
    expect(vista?.ejecutarDeNuevo).toEqual({ posible: false, motivo: "corrida_de_prueba" });
  });
});

describe("reanudar desde el fallo", () => {
  it("sigue desde el nodo que falló —nunca desde el disparador— sin repetir lo que ya se hizo", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx);

    expect(await ctx.service.reanudar(run.id)).toEqual({
      runId: run.id,
      desdePaso: 3,
      nodoId: "m",
    });
    expect(ctx.emitidos).toEqual([
      { runId: run.id, desdePaso: 3, id: `workflow-segmento-reanudado:${run.id}:3:id-fijo` },
    ]);
    // No es el id del segmento que ya corrió: Inngest lo descartaría por duplicado.
    expect(ctx.emitidos[0]?.id).not.toBe(`workflow-segmento-pendiente:${run.id}:3`);

    // Mientras espera que Inngest la tome, la vista la muestra parada en `m`.
    expect((await ctx.service.vista(run.id))?.nodos.find((n) => n.nodoId === "m")?.estado).toBe(
      "activo",
    );

    const r = await correrSegmento(ctx, run.id, 3, async () => ({
      puerto: "salida",
      salida: { ok: true },
    }));

    expect(r).toEqual({ tipo: "fin" });
    const pasos = await ctx.runs.pasosDeRun(run.id);
    expect(pasos.map((p) => [p.nodo_id, p.orden, p.error === null])).toEqual([
      ["t", 1, true],
      ["a", 2, true],
      ["m", 3, false],
      ["m", 4, true],
      ["fin", 5, true],
    ]);
    expect(ctx.llamadas.anotar).toBe(1);
    expect((await ctx.runs.findRun(run.id))?.estado).toBe("terminado");
  });

  it("dos veces: la segunda ya no la encuentra fallada y no encola nada", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx);
    await ctx.service.reanudar(run.id);

    await expect(ctx.service.reanudar(run.id)).rejects.toBeInstanceOf(IllegalStateError);
    expect(ctx.emitidos).toHaveLength(1);
  });

  it("si no se puede encolar, la corrida vuelve a quedar fallada: no queda viva sin nadie que la tome", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx);
    ctx.caerEmision();

    await expect(ctx.service.reanudar(run.id)).rejects.toBeInstanceOf(InfraError);

    const despues = await ctx.runs.findRun(run.id);
    expect(despues?.estado).toBe("fallado");
    expect(despues?.error).toContain("no se pudo reanudar");
    expect(await ctx.runs.contarVivasPorVersion(ctx.w.id)).toEqual([]);
  });

  it("una corrida de Probar no se reanuda con el motor de producción", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx, { [MARCA_CORRIDA_DE_PRUEBA]: true });

    await expect(ctx.service.reanudar(run.id)).rejects.toBeInstanceOf(IllegalStateError);
    expect(ctx.emitidos).toEqual([]);
  });

  it("con otra corrida viva del mismo flujo para el lead: ConflictError", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx);
    await ctx.runs.arrancar({
      versionId: ctx.v.id,
      leadId: ctx.lead.id,
      sessionId: null,
      contexto: {},
    });

    await expect(ctx.service.reanudar(run.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("una corrida que no existe: NotFoundError", async () => {
    const ctx = await escenario();
    await expect(
      ctx.service.reanudar("00000000-0000-4000-8000-000000000999"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("ejecutar de nuevo desde el principio", () => {
  it("arranca una corrida nueva de la misma versión, lead y contexto, y encola su primer segmento", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx, { lead: { etapa: "cotizado" } });

    const { runId } = await ctx.service.ejecutarDeNuevo(run.id);

    expect(runId).not.toBe(run.id);
    expect(await ctx.runs.findRun(runId)).toMatchObject({
      workflow_version_id: ctx.v.id,
      lead_id: ctx.lead.id,
      contexto: { lead: { etapa: "cotizado" } },
      estado: "corriendo",
      pasos_ejecutados: 0,
    });
    expect(ctx.emitidos).toEqual([
      { runId, desdePaso: 0, id: `workflow-segmento-pendiente:${runId}:0` },
    ]);
    expect((await ctx.runs.findRun(run.id))?.estado).toBe("fallado");
  });

  it("con otra corrida viva del mismo flujo para el lead: ConflictError", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx);
    await ctx.runs.arrancar({
      versionId: ctx.v.id,
      leadId: ctx.lead.id,
      sessionId: null,
      contexto: {},
    });

    await expect(ctx.service.ejecutarDeNuevo(run.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("una corrida de Probar no se relanza con el motor de producción", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx, { [MARCA_CORRIDA_DE_PRUEBA]: true });

    await expect(ctx.service.ejecutarDeNuevo(run.id)).rejects.toBeInstanceOf(IllegalStateError);
  });

  it("si no se puede encolar, la corrida nueva queda fallada: nada queda vivo sin segmento", async () => {
    const ctx = await escenario();
    const run = await falladaEnM(ctx);
    ctx.caerEmision();

    await expect(ctx.service.ejecutarDeNuevo(run.id)).rejects.toBeInstanceOf(InfraError);
    expect(await ctx.runs.contarVivasPorVersion(ctx.w.id)).toEqual([]);
  });
});

/**
 * PRD 6.6 por el camino de produccion entero: el mismo `segmentoHandler` que
 * corre Inngest, con una accion que un tope salta.
 */
describe("un tope salta el mensaje en produccion", () => {
  const avisarSaltado: AccionHandler = async () => ({
    puerto: "salida",
    salto: { motivo: "sin_ventana", detalle: "ventana cerrada" },
  });

  it("la corrida TERMINA (no falla), guarda el motivo y el lead no sigue al paso siguiente", async () => {
    const ctx = await escenario();
    const { run } = await ctx.runs.arrancar({
      versionId: ctx.v.id,
      leadId: ctx.lead.id,
      sessionId: null,
      contexto: {},
    });

    const r = await correrSegmento(ctx, run!.id, 0, avisarSaltado);

    expect(r).toEqual({ tipo: "fin" });
    const detalle = await ctx.runs.detalleRun(run!.id);
    expect(detalle?.estado).toBe("terminado");
    expect(detalle?.error).toBeNull();
    expect(detalle?.motivo_salto).toBe("sin_ventana");
    expect(detalle?.pasos.map((p) => p.nodo_id)).toEqual(["t", "a", "m"]);
    expect(detalle?.pasos.at(-1)).toMatchObject({
      error: null,
      salida: { motivo_salto: "sin_ventana" },
    });
  });

  it("sobre el lienzo, el nodo saltado se pinta 'saltado', no 'fallado', y no ofrece reanudar", async () => {
    const ctx = await escenario();
    const { run } = await ctx.runs.arrancar({
      versionId: ctx.v.id,
      leadId: ctx.lead.id,
      sessionId: null,
      contexto: {},
    });
    await correrSegmento(ctx, run!.id, 0, avisarSaltado);

    const vista = await ctx.service.vista(run!.id);

    expect(vista?.nodos.map((n) => [n.nodoId, n.estado])).toEqual([
      ["t", "completado"],
      ["a", "completado"],
      ["m", "saltado"],
      ["fin", "pendiente"],
    ]);
    expect(vista?.reanudar).toEqual({ posible: false, motivo: "corrida_no_fallada" });
  });
});
