import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { Grafo } from "@/types/workflows";

const GRAFO: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "f", tipo: "fin", config: {}, posicion: { x: 1, y: 0 } },
  ],
  aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
};

export function runWorkflowsContract(makeRepo: () => WorkflowsRepository) {
  describe("WorkflowsRepository", () => {
    let repo: WorkflowsRepository;
    beforeEach(() => {
      repo = makeRepo();
    });

    it("crea y lista workflows", async () => {
      await repo.crearWorkflow({ nombre: "Seguimiento", descripcion: null, activo: false });
      const todos = await repo.listarWorkflows();
      expect(todos).toHaveLength(1);
      expect(todos[0]?.nombre).toBe("Seguimiento");
    });

    it("la primera version de un workflow es la 1", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      expect(await repo.proximaVersion(w.id)).toBe(1);
    });

    it("proximaVersion avanza con cada version creada", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        created_by: null,
      });
      expect(await repo.proximaVersion(w.id)).toBe(2);
    });

    it("publicar despublica la anterior: solo puede haber una publicada", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      const v1 = await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        created_by: null,
      });
      const v2 = await repo.crearVersion({
        workflow_id: w.id,
        version: 2,
        grafo: GRAFO,
        max_pasos: 500,
        created_by: null,
      });

      await repo.publicarVersion(v1.id);
      expect((await repo.findVersionPublicada(w.id))?.id).toBe(v1.id);

      await repo.publicarVersion(v2.id);
      const publicada = await repo.findVersionPublicada(w.id);
      expect(publicada?.id).toBe(v2.id);

      // La v1 sigue existiendo: las corridas que la estaban ejecutando la necesitan.
      const versiones = await repo.listarVersiones(w.id);
      expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]);
    });

    it("un workflow sin version publicada devuelve null", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      expect(await repo.findVersionPublicada(w.id)).toBeNull();
    });

    it("una version recien creada nace despublicada", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      const v = await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        created_by: null,
      });
      expect(v.publicada).toBe(false);
      expect(await repo.findVersionPublicada(w.id)).toBeNull();
    });

    it("el grafo sobrevive el viaje de ida y vuelta", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      const v = await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        created_by: null,
      });
      const leida = await repo.listarVersiones(w.id);
      expect(leida[0]?.grafo).toEqual(GRAFO);
      expect(leida[0]?.id).toBe(v.id);
    });
  });
}
