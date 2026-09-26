import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { leerFlujoImportado } from "@/lib/validation/importar-flujo.schema";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { importarFlujo } from "@/server/services/workflows/importar-flujo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";

/**
 * Importar un flujo desde JSON. Dos puertas: Zod para la forma
 * (`leerFlujoImportado`) y `validarGrafo` para el sentido, que es la misma que
 * pasa Guardar. Entra como borrador: una versión guardada, nunca publicada, y
 * el flujo apagado.
 */

const GRAFO = {
  nodos: [
    { id: "n1", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
    { id: "n2", tipo: "crm_etiqueta_add", config: {}, posicion: { x: 0, y: 144 } },
    { id: "n3", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 288 } },
  ],
  aristas: [
    { desde: "n1", hasta: "n2", puerto: "salida" },
    { desde: "n2", hasta: "n3", puerto: "salida" },
  ],
};

function build() {
  const workflows = new InMemoryWorkflowsRepository();
  const svc = new DefaultWorkflowsAdminService({
    workflows,
    workflowRuns: new InMemoryWorkflowRunsRepository(),
    leads: new InMemoryLeadsRepository(),
  });
  return { svc };
}

describe("leerFlujoImportado", () => {
  it("acepta un flujo con nombre y grafo, y completa el tope por defecto", () => {
    const r = leerFlujoImportado(JSON.stringify({ nombre: "Etiquetar", grafo: GRAFO }));
    expect(r.ok && r.flujo.maxPasos).toBe(500);
    expect(r.ok && r.flujo.descripcion).toBeNull();
  });

  it("un texto que no es JSON se dice con palabras", () => {
    const r = leerFlujoImportado("{ esto no es json");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("JSON") });
  });

  it("un tipo de bloque que no existe no pasa la forma", () => {
    const malo = { ...GRAFO, nodos: [{ ...GRAFO.nodos[0], tipo: "bloque_inventado" }] };
    const r = leerFlujoImportado(JSON.stringify({ nombre: "X", grafo: malo }));
    expect(r.ok).toBe(false);
  });

  it("sin nombre no entra", () => {
    expect(leerFlujoImportado(JSON.stringify({ grafo: GRAFO })).ok).toBe(false);
  });
});

describe("importarFlujo", () => {
  it("crea el flujo apagado con una versión guardada y sin publicar", async () => {
    const { svc } = build();
    const r = await importarFlujo(svc, {
      nombre: "Etiquetar",
      descripcion: null,
      grafo: GRAFO as never,
      maxPasos: 120,
      userId: null,
    });
    const detalle = await svc.detalle(r.workflowId);
    expect(detalle?.workflow.activo).toBe(false);
    expect(detalle?.versiones).toHaveLength(1);
    expect(detalle?.versiones[0]?.publicada).toBe(false);
    expect(detalle?.versiones[0]?.max_pasos).toBe(120);
    // La etiqueta sin elegir no impide importar, pero sí publicar: se cuenta.
    expect(r.problemasParaPublicar).toBeGreaterThan(0);
  });

  it("un grafo sin sentido se rechaza y no deja un flujo vacío en la lista", async () => {
    const { svc } = build();
    const roto = { nodos: GRAFO.nodos, aristas: [] };
    await expect(
      importarFlujo(svc, {
        nombre: "Roto",
        descripcion: null,
        grafo: roto as never,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await svc.listar()).toEqual([]);
  });
});
