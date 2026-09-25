import { describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import { MARCA_CORRIDA_DE_PRUEBA, type Grafo } from "@/types/workflows";

// Grafos armados a mano para estos tests: no salen de ningún dato real.
const VALIDO: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "f", tipo: "fin", config: {}, posicion: { x: 1, y: 0 } },
  ],
  aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
};

const OTRO: Grafo = {
  nodos: [
    {
      id: "d",
      tipo: "disparador",
      config: { disparador: "mensaje_recibido" },
      posicion: { x: 0, y: 0 },
    },
    { id: "f", tipo: "fin", config: {}, posicion: { x: 1, y: 0 } },
  ],
  aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
};

/** Dos acciones que se apuntan: ciclo sin espera. `validarGrafo` lo rechaza. */
const CICLO_SIN_ESPERA: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "a1", tipo: "accion", config: {}, posicion: { x: 1, y: 0 } },
    { id: "a2", tipo: "accion", config: {}, posicion: { x: 2, y: 0 } },
  ],
  aristas: [
    { desde: "d", hasta: "a1", puerto: "salida" },
    { desde: "a1", hasta: "a2", puerto: "salida" },
    { desde: "a2", hasta: "a1", puerto: "salida" },
  ],
};

/**
 * Bien conectado pero con un bloque sin configurar: `guardarVersion` lo acepta
 * (sólo mira la estructura) y publicar tiene que rechazarlo.
 */
const MENSAJE_VACIO: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    { id: "m", tipo: "msg_texto", config: {}, posicion: { x: 1, y: 0 } },
    { id: "f", tipo: "logica_detener", config: {}, posicion: { x: 2, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "m", puerto: "salida" },
    { desde: "m", hasta: "f", puerto: "salida" },
  ],
};

function build() {
  const versionDeWorkflow = new Map<string, string>();
  const workflows = new InMemoryWorkflowsRepository();
  const workflowRuns = new InMemoryWorkflowRunsRepository((v) => versionDeWorkflow.get(v));
  const leads = new InMemoryLeadsRepository();
  const service = new DefaultWorkflowsAdminService({ workflows, workflowRuns, leads });
  return { workflows, workflowRuns, leads, service, versionDeWorkflow };
}

async function conDosVersiones(ctx: ReturnType<typeof build>) {
  const w = await ctx.service.crear({ nombre: "Seguimiento", descripcion: null });
  const v1 = await ctx.service.guardarVersion({
    workflowId: w.id,
    grafo: VALIDO,
    maxPasos: 50,
    userId: null,
  });
  const v2 = await ctx.service.guardarVersion({
    workflowId: w.id,
    grafo: OTRO,
    maxPasos: 500,
    userId: null,
  });
  ctx.versionDeWorkflow.set(v1.id, w.id);
  ctx.versionDeWorkflow.set(v2.id, w.id);
  return { w, v1, v2 };
}

describe("publicar con nota", () => {
  it("la nota queda en la versión publicada", async () => {
    const ctx = build();
    const { w, v1 } = await conDosVersiones(ctx);

    const publicada = await ctx.service.publicar(v1.id, "Primera versión del seguimiento");

    expect(publicada.nota).toBe("Primera versión del seguimiento");
    expect((await ctx.service.versionPublicada(w.id))?.nota).toBe(
      "Primera versión del seguimiento",
    );
  });

  it("sin nota, la versión conserva la que tenía", async () => {
    const ctx = build();
    const { v1, v2 } = await conDosVersiones(ctx);
    await ctx.service.publicar(v1.id, "Primera");
    await ctx.service.publicar(v2.id);

    expect((await ctx.service.publicar(v1.id)).nota).toBe("Primera");
  });

  it("publicar no toca las corridas en curso: terminan en la versión donde arrancaron", async () => {
    const ctx = build();
    const { w, v1, v2 } = await conDosVersiones(ctx);
    await ctx.service.publicar(v1.id);
    const { run } = await ctx.workflowRuns.arrancar({
      versionId: v1.id,
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    await ctx.workflowRuns.esperar(run!.id, "f", {}, 1);

    await ctx.service.publicar(v2.id, "Cambia el disparador");

    expect(await ctx.workflowRuns.findRun(run!.id)).toMatchObject({
      workflow_version_id: v1.id,
      estado: "esperando",
      nodo_actual: "f",
      pasos_ejecutados: 1,
    });
    // La versión con la que sigue es la de siempre, intacta: el segmento lee
    // la pinneada (`findVersion(run.workflow_version_id)`), no la publicada.
    const pinneada = (await ctx.service.detalle(w.id))?.versiones.find((v) => v.id === v1.id);
    expect(pinneada?.grafo).toEqual(VALIDO);
    expect(pinneada?.publicada).toBe(false);
    expect(await ctx.workflowRuns.tomarSegmento(run!.id, 1)).not.toBeNull();
  });
});

describe("previaPublicacion — lo que pinta DiffPublicacion", () => {
  it("la versión a publicar, la publicada hoy y cuántas corridas siguen vivas en cada versión", async () => {
    const ctx = build();
    const { w, v1, v2 } = await conDosVersiones(ctx);
    await ctx.service.publicar(v1.id);
    for (const leadId of ["lead-1", "lead-2"]) {
      await ctx.workflowRuns.arrancar({ versionId: v1.id, leadId, sessionId: null, contexto: {} });
    }
    const { run: terminada } = await ctx.workflowRuns.arrancar({
      versionId: v1.id,
      leadId: "lead-3",
      sessionId: null,
      contexto: {},
    });
    await ctx.workflowRuns.terminar(terminada!.id, 2);

    const previa = await ctx.service.previaPublicacion(v2.id);

    expect(previa).toEqual({
      workflow: { id: w.id, nombre: "Seguimiento" },
      nueva: { id: v2.id, version: 2, grafo: OTRO, nota: null, publicada: false },
      actual: { id: v1.id, version: 1, grafo: VALIDO },
      corridasVivas: {
        total: 2,
        porVersion: [{ versionId: v1.id, version: 1, cantidad: 2 }],
      },
      problemas: [],
    });
  });

  it("un workflow que nunca publicó: sin versión actual y sin corridas vivas", async () => {
    const ctx = build();
    const { v1 } = await conDosVersiones(ctx);

    const previa = await ctx.service.previaPublicacion(v1.id);

    expect(previa?.actual).toBeNull();
    expect(previa?.corridasVivas).toEqual({ total: 0, porVersion: [] });
  });

  it("una versión que no existe: null", async () => {
    const ctx = build();
    expect(await ctx.service.previaPublicacion("00000000-0000-4000-8000-000000000999")).toBeNull();
  });
});

describe("crearVersionDesde", () => {
  it("un borrador nuevo con el grafo y el tope de la versión de origen, sin publicar", async () => {
    const ctx = build();
    const { v1 } = await conDosVersiones(ctx);

    const copia = await ctx.service.crearVersionDesde(
      v1.id,
      "00000000-0000-4000-8000-0000000000a1",
    );

    expect(copia.version).toBe(3);
    expect(copia.grafo).toEqual(VALIDO);
    expect(copia.max_pasos).toBe(50);
    expect(copia.publicada).toBe(false);
    expect(copia.created_by).toBe("00000000-0000-4000-8000-0000000000a1");
    expect(copia.nota).toBeNull();
  });

  it("una versión de origen que no existe: NotFoundError", async () => {
    const ctx = build();
    await expect(
      ctx.service.crearVersionDesde("00000000-0000-4000-8000-000000000999", null),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("copiar también pasa por la validación: un grafo que hoy no la pasa no se copia", async () => {
    const ctx = build();
    const w = await ctx.service.crear({ nombre: "W", descripcion: null });
    // Guardado por debajo de la puerta del servicio, como si las reglas se
    // hubieran endurecido después de guardarlo.
    const vieja = await ctx.workflows.crearVersion({
      workflow_id: w.id,
      version: 1,
      grafo: CICLO_SIN_ESPERA,
      max_pasos: 500,
      created_by: null,
    });

    await expect(ctx.service.crearVersionDesde(vieja.id, null)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await ctx.workflows.listarVersiones(w.id)).toHaveLength(1);
  });
});

describe("rollbackAVersion — restaurar una versión vieja", () => {
  it("crea una versión nueva y la publica; la vieja no revive", async () => {
    const ctx = build();
    const { w, v1, v2 } = await conDosVersiones(ctx);
    await ctx.service.publicar(v2.id);

    const restaurada = await ctx.service.rollbackAVersion(w.id, v1.id, null);

    expect(restaurada.id).not.toBe(v1.id);
    expect(restaurada.version).toBe(3);
    expect(restaurada.grafo).toEqual(VALIDO);
    expect(restaurada.publicada).toBe(true);
    expect((await ctx.service.versionPublicada(w.id))?.id).toBe(restaurada.id);
    const versiones = (await ctx.service.detalle(w.id))?.versiones ?? [];
    expect(versiones.find((v) => v.id === v1.id)?.publicada).toBe(false);
    expect(versiones.find((v) => v.id === v2.id)?.publicada).toBe(false);
  });

  it("sin nota, la restauración dice de qué versión salió; con nota, usa la que se escribió", async () => {
    const ctx = build();
    const { w, v1 } = await conDosVersiones(ctx);

    expect((await ctx.service.rollbackAVersion(w.id, v1.id, null)).nota).toBe(
      "Restaurada desde la versión 1",
    );
    expect(
      (await ctx.service.rollbackAVersion(w.id, v1.id, null, "Vuelve el saludo corto")).nota,
    ).toBe("Vuelve el saludo corto");
  });

  it("una versión de otro workflow: ValidationError, sin crear nada", async () => {
    const ctx = build();
    const { v1 } = await conDosVersiones(ctx);
    const otro = await ctx.service.crear({ nombre: "Otro", descripcion: null });

    await expect(ctx.service.rollbackAVersion(otro.id, v1.id, null)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await ctx.workflows.listarVersiones(otro.id)).toEqual([]);
  });
});

describe("probar marca su corrida como de prueba", () => {
  it("el contexto de la corrida lleva la marca que reanudar y relanzar rechazan", async () => {
    const ctx = build();
    const w = await ctx.service.crear({ nombre: "W", descripcion: null });
    const lead = await ctx.leads.create({
      nombre: "Lead de prueba",
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

    const { runId } = await ctx.service.probar({
      workflowId: w.id,
      grafo: {
        nodos: [
          { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
          { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 1, y: 0 } },
        ],
        aristas: [{ desde: "t", hasta: "fin", puerto: "salida" }],
      },
      maxPasos: 10,
      leadId: lead.id,
      userId: null,
    });

    expect((await ctx.workflowRuns.findRun(runId))?.contexto[MARCA_CORRIDA_DE_PRUEBA]).toBe(true);
  });
});

describe("publicar valida el flujo en el servidor", () => {
  it("una versión con un bloque sin configurar no se publica y el error nombra el nodo", async () => {
    const ctx = build();
    const w = await ctx.service.crear({ nombre: "W", descripcion: null });
    const v = await ctx.service.guardarVersion({
      workflowId: w.id,
      grafo: MENSAJE_VACIO,
      maxPasos: 50,
      userId: null,
    });

    const error = await ctx.service.publicar(v.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues).toEqual([
      { nodoId: "m", mensaje: "El mensaje no puede estar vacío" },
    ]);
    expect(await ctx.service.versionPublicada(w.id)).toBeNull();
  });

  it("restaurar una versión con errores tampoco publica, y no crea la copia", async () => {
    const ctx = build();
    const w = await ctx.service.crear({ nombre: "W", descripcion: null });
    const rota = await ctx.service.guardarVersion({
      workflowId: w.id,
      grafo: MENSAJE_VACIO,
      maxPasos: 50,
      userId: null,
    });
    const sana = await ctx.service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 50,
      userId: null,
    });
    await ctx.service.publicar(sana.id);

    const error = await ctx.service.rollbackAVersion(w.id, rota.id, null).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues).toEqual([
      { nodoId: "m", mensaje: "El mensaje no puede estar vacío" },
    ]);
    expect(await ctx.workflows.listarVersiones(w.id)).toHaveLength(2);
    expect((await ctx.service.versionPublicada(w.id))?.id).toBe(sana.id);
  });

  it("la previa trae los errores de la versión, para que la pantalla los muestre antes de apretar", async () => {
    const ctx = build();
    const w = await ctx.service.crear({ nombre: "W", descripcion: null });
    const rota = await ctx.service.guardarVersion({
      workflowId: w.id,
      grafo: MENSAJE_VACIO,
      maxPasos: 50,
      userId: null,
    });
    const sana = await ctx.service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 50,
      userId: null,
    });

    expect((await ctx.service.previaPublicacion(rota.id))?.problemas).toEqual([
      { nodoId: "m", mensaje: "El mensaje no puede estar vacío" },
    ]);
    expect((await ctx.service.previaPublicacion(sana.id))?.problemas).toEqual([]);
  });
});
