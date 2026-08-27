import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { Grafo } from "@/types/workflows";

const VALIDO: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "f", tipo: "fin", config: {}, posicion: { x: 1, y: 0 } },
  ],
  aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
};

/** Dos acciones que se apuntan: ciclo sin espera. */
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

function build() {
  const repo = new InMemoryWorkflowsRepository();
  const runs = new InMemoryWorkflowRunsRepository();
  const leads = new InMemoryLeadsRepository();
  return {
    repo,
    runs,
    leads,
    service: new DefaultWorkflowsAdminService({ workflows: repo, workflowRuns: runs, leads }),
  };
}

describe("DefaultWorkflowsAdminService", () => {
  it("guarda una version con un grafo valido", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "Seguimiento", descripcion: null });
    const v = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    expect(v.version).toBe(1);
    expect(v.publicada).toBe(false);
  });

  it("numera las versiones de forma creciente", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await service.guardarVersion({ workflowId: w.id, grafo: VALIDO, maxPasos: 500, userId: null });
    const v2 = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    expect(v2.version).toBe(2);
  });

  it("rechaza un grafo con un ciclo sin espera", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        grafo: CICLO_SIN_ESPERA,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("el error de un grafo invalido nombra la regla que se rompio", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        grafo: CICLO_SIN_ESPERA,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toThrow(/ciclo_sin_espera/);
  });

  it("un grafo invalido no deja version guardada", async () => {
    const { repo, service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        grafo: CICLO_SIN_ESPERA,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toThrow();
    expect(await repo.listarVersiones(w.id)).toHaveLength(0);
  });

  it("rechaza un grafo con la forma rota antes de validar la semantica", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    // El fixture también rompería la etapa semántica si corriera sola (el nodo
    // "inventado" no es `disparador` y por lo tanto viola `disparador_unico`),
    // así que basta con `ValidationError` no alcanza para probar el orden:
    // ambas etapas producen ese mismo tipo de error. Lo que distingue una
    // etapa de la otra es el código que el service adjunta en `issues`
    // (ver `workflows-admin.service.ts`) — sólo la etapa Zod puede producir
    // "grafo_forma_invalida", porque si `validarGrafo` corriera primero
    // recibiría un grafo sin parsear y el problema sería "grafo_invalido".
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        // tipo inexistente: no pasa el schema Zod
        grafo: {
          nodos: [{ id: "x", tipo: "inventado", config: {}, posicion: { x: 0, y: 0 } }],
          aristas: [],
        } as unknown as Grafo,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toMatchObject({ issues: "grafo_forma_invalida" });
  });

  it("publicar deja esa version como la publicada", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const v = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    await service.publicar(v.id);
    expect((await service.versionPublicada(w.id))?.id).toBe(v.id);
  });

  /*
   * Las dos lecturas que necesita la pantalla de detalle. Van en el servicio y
   * no llamando al repo desde la UI porque `app/**` no puede importar
   * `server/repositories/**` — es una regla dura de boundaries, y con motivo:
   * la pantalla no tiene por qué saber que existe un repo.
   */
  it("detalle devuelve el workflow con sus versiones, la ultima primero", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const v1 = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 10,
      userId: null,
    });
    const v2 = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 10,
      userId: null,
    });

    const d = await service.detalle(w.id);

    expect(d?.workflow.id).toBe(w.id);
    // La version mas nueva arriba: es la que se esta por publicar.
    expect(d?.versiones.map((v) => v.id)).toEqual([v2.id, v1.id]);
    expect(d?.versiones.map((v) => v.version)).toEqual([2, 1]);
  });

  it("detalle de un workflow que no existe devuelve null", async () => {
    const { service } = build();

    expect(await service.detalle("00000000-0000-4000-8000-000000000999")).toBeNull();
  });

  it("detalle de un workflow sin versiones devuelve la lista vacia", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });

    const d = await service.detalle(w.id);

    expect(d?.workflow.nombre).toBe("W");
    expect(d?.versiones).toEqual([]);
  });
});

/**
 * `runs.arrancar` sólo recibe `versionId`; para que `metricasPorWorkflow`
 * agrupe por el workflow correcto (y no por la versión, su fallback sin
 * resolver) cada test que necesita runs registra el par en este mapa antes de
 * arrancar la corrida -- mismo patrón que ya usa
 * `tests/unit/workflow-runs-repo.test.ts` para el escopeo de "corrida viva".
 */
function buildConRuns() {
  const versionDeWorkflow = new Map<string, string>();
  const workflows = new InMemoryWorkflowsRepository();
  const workflowRuns = new InMemoryWorkflowRunsRepository((versionId) =>
    versionDeWorkflow.get(versionId),
  );
  const leads = new InMemoryLeadsRepository();
  const service = new DefaultWorkflowsAdminService({ workflows, workflowRuns, leads });
  return { workflows, workflowRuns, leads, service, versionDeWorkflow };
}

describe("DefaultWorkflowsAdminService.listarConResumen", () => {
  it("un workflow sin ninguna version es 'borrador', sin métricas ni pasos", async () => {
    const { service } = buildConRuns();
    await service.crear({ nombre: "W", descripcion: null });

    const [resumen] = await service.listarConResumen();

    expect(resumen?.estado).toBe("borrador");
    expect(resumen?.tieneVersionBorrador).toBe(false);
    expect(resumen?.versionPublicada).toBeNull();
    expect(resumen?.resumenPasos).toEqual([]);
    expect(resumen?.metricas).toEqual({ totalRuns: 0, runsExitosos: 0, ultimoRun: null });
  });

  it("con version publicada y prendido, sin runs recientes que hayan fallado: 'activo'", async () => {
    const { service } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const v = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    await service.publicar(v.id);
    await service.reanudar(w.id);

    const [resumen] = await service.listarConResumen();

    expect(resumen?.estado).toBe("activo");
    expect(resumen?.versionPublicada).toBe(1);
    expect(resumen?.resumenPasos.length).toBeGreaterThan(0);
  });

  it("apagado con version publicada: 'pausado', pise o no un fallo viejo", async () => {
    const { service } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const v = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    await service.publicar(v.id);
    // Nace apagado (`crear()`): no hace falta pausar para probar este caso.

    const [resumen] = await service.listarConResumen();

    expect(resumen?.estado).toBe("pausado");
  });

  it("prendido con la corrida más reciente fallada: 'error'", async () => {
    const { service, workflowRuns, versionDeWorkflow } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const v = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    await service.publicar(v.id);
    await service.reanudar(w.id);

    versionDeWorkflow.set(v.id, w.id);
    const { run } = await workflowRuns.arrancar({
      versionId: v.id,
      leadId: "lead-1",
      sessionId: null,
      contexto: {},
    });
    await workflowRuns.fallar(run!.id, "el tool tardó demasiado", 1);

    const [resumen] = await service.listarConResumen();

    expect(resumen?.estado).toBe("error");
    expect(resumen?.metricas.totalRuns).toBe(1);
    expect(resumen?.metricas.runsExitosos).toBe(0);
    expect(resumen?.metricas.ultimoRun?.exito).toBe(false);
  });

  it("una version nueva sin publicar sobre una publicada: tieneVersionBorrador true", async () => {
    const { service } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const v1 = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    await service.publicar(v1.id);
    await service.guardarVersion({ workflowId: w.id, grafo: VALIDO, maxPasos: 500, userId: null });

    const [resumen] = await service.listarConResumen();

    expect(resumen?.tieneVersionBorrador).toBe(true);
    expect(resumen?.versionPublicada).toBe(1);
  });

  it("sin ningún workflow, devuelve la lista vacía sin tocar workflowRuns", async () => {
    const { service, workflowRuns } = buildConRuns();
    const spy = vi.spyOn(workflowRuns, "metricasPorWorkflow");

    expect(await service.listarConResumen()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("DefaultWorkflowsAdminService.duplicar", () => {
  it("copia nombre, descripción y la última versión guardada a un workflow nuevo y apagado", async () => {
    const { service } = buildConRuns();
    const w = await service.crear({ nombre: "Original", descripcion: "una descripción" });
    await service.guardarVersion({ workflowId: w.id, grafo: VALIDO, maxPasos: 77, userId: null });

    const copia = await service.duplicar(w.id);

    expect(copia.nombre).toBe("Original (copia)");
    expect(copia.descripcion).toBe("una descripción");
    expect(copia.activo).toBe(false);

    const detalle = await service.detalle(copia.id);
    expect(detalle?.versiones).toHaveLength(1);
    expect(detalle?.versiones[0]?.grafo).toEqual(VALIDO);
    expect(detalle?.versiones[0]?.max_pasos).toBe(77);
    expect(detalle?.versiones[0]?.publicada).toBe(false);
  });

  it("duplicar un workflow sin ninguna version no crea ninguna en la copia", async () => {
    const { service } = buildConRuns();
    const w = await service.crear({ nombre: "Sin version", descripcion: null });

    const copia = await service.duplicar(w.id);

    const detalle = await service.detalle(copia.id);
    expect(detalle?.versiones).toEqual([]);
  });

  it("el nombre de la copia no supera el tope de 80 caracteres", async () => {
    const { service } = buildConRuns();
    const nombreLargo = "N".repeat(80);
    const w = await service.crear({ nombre: nombreLargo, descripcion: null });

    const copia = await service.duplicar(w.id);

    expect(copia.nombre.length).toBeLessThanOrEqual(80);
    expect(copia.nombre.endsWith(" (copia)")).toBe(true);
  });

  it("duplicar un workflow inexistente rechaza con NotFoundError", async () => {
    const { service } = buildConRuns();
    await expect(service.duplicar("00000000-0000-4000-8000-000000000999")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("DefaultWorkflowsAdminService.pausar / reanudar / eliminar", () => {
  it("pausar apaga y reanudar prende", async () => {
    const { service } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });

    await service.reanudar(w.id);
    expect((await service.listar()).find((x) => x.id === w.id)?.activo).toBe(true);

    await service.pausar(w.id);
    expect((await service.listar()).find((x) => x.id === w.id)?.activo).toBe(false);
  });

  it("eliminar saca el workflow del listado", async () => {
    const { service } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });

    await service.eliminar(w.id);

    expect(await service.listar()).toEqual([]);
  });
});

/** trigger_manual -> msg_texto -> logica_detener: completa en un solo segmento. */
const GRAFO_PROBAR_SIMPLE: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    {
      id: "m",
      tipo: "msg_texto",
      config: { mensaje: "hola {{lead.nombre}}" },
      posicion: { x: 1, y: 0 },
    },
    { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 2, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "m", puerto: "salida" },
    { desde: "m", hasta: "fin", puerto: "salida" },
  ],
};

/**
 * trigger_manual -> logica_esperar -> logica_detener: el motor corta en la
 * espera antes de llegar al nodo final, así que la corrida queda viva. El
 * nodo final sólo está para que `validarGrafo` acepte la salida de "e".
 */
const GRAFO_PROBAR_CON_ESPERA: Grafo = {
  nodos: [
    { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    {
      id: "e",
      tipo: "logica_esperar",
      config: { duracion: 10, unidad: "minutos" },
      posicion: { x: 1, y: 0 },
    },
    { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 2, y: 0 } },
  ],
  aristas: [
    { desde: "t", hasta: "e", puerto: "salida" },
    { desde: "e", hasta: "fin", puerto: "salida" },
  ],
};

async function crearLeadDePrueba(leads: InMemoryLeadsRepository) {
  return leads.create({
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
}

describe("DefaultWorkflowsAdminService.probar", () => {
  it("guarda el grafo actual como version y arranca una corrida real hasta terminar", async () => {
    const { service, workflows, workflowRuns, leads } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const lead = await crearLeadDePrueba(leads);

    const { runId, resultado } = await service.probar({
      workflowId: w.id,
      grafo: GRAFO_PROBAR_SIMPLE,
      maxPasos: 50,
      leadId: lead.id,
      userId: null,
    });

    expect(resultado.tipo).toBe("completado");
    expect(await workflows.listarVersiones(w.id)).toHaveLength(1);

    const run = await workflowRuns.findRun(runId);
    expect(run?.estado).toBe("terminado");
    expect(run?.pasos_ejecutados).toBe(3);
    expect(await workflowRuns.pasosDeRun(runId)).toHaveLength(3);
  });

  it("una corrida de prueba que corta en una espera queda 'esperando'", async () => {
    const { service, workflowRuns, leads } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const lead = await crearLeadDePrueba(leads);

    const { runId, resultado } = await service.probar({
      workflowId: w.id,
      grafo: GRAFO_PROBAR_CON_ESPERA,
      maxPasos: 50,
      leadId: lead.id,
      userId: null,
    });

    expect(resultado.tipo).toBe("esperando");
    const run = await workflowRuns.findRun(runId);
    expect(run?.estado).toBe("esperando");
  });

  it("lead inexistente: NotFoundError, sin arrancar ninguna corrida", async () => {
    const { service, workflowRuns } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });

    await expect(
      service.probar({
        workflowId: w.id,
        grafo: GRAFO_PROBAR_SIMPLE,
        maxPasos: 50,
        leadId: "00000000-0000-0000-0000-000000000000",
        userId: null,
      }),
    ).rejects.toThrow(NotFoundError);

    expect(await workflowRuns.metricasPorWorkflow([w.id], new Date(0))).toEqual({});
  });

  it("ya hay una corrida viva para ese lead: ConflictError, no arranca una segunda", async () => {
    const { service, leads } = buildConRuns();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const lead = await crearLeadDePrueba(leads);

    await service.probar({
      workflowId: w.id,
      grafo: GRAFO_PROBAR_CON_ESPERA,
      maxPasos: 50,
      leadId: lead.id,
      userId: null,
    });

    await expect(
      service.probar({
        workflowId: w.id,
        grafo: GRAFO_PROBAR_CON_ESPERA,
        maxPasos: 50,
        leadId: lead.id,
        userId: null,
      }),
    ).rejects.toThrow(ConflictError);
  });
});
