import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
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
  return { repo, service: new DefaultWorkflowsAdminService({ workflows: repo }) };
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
    ).rejects.toThrow(ValidationError);
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
});
