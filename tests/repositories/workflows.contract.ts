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

function grafoConDisparador(disparador: string): Grafo {
  return {
    nodos: [
      {
        id: "d",
        tipo: "disparador",
        config: { disparador },
        posicion: { x: 0, y: 0 },
      },
      { id: "f", tipo: "fin", config: {}, posicion: { x: 1, y: 0 } },
    ],
    aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
  };
}

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

    it("findVersion trae una version por id, publicada o no; null si no existe", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      const v = await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        created_by: null,
      });
      expect((await repo.findVersion(v.id))?.id).toBe(v.id);
      expect(await repo.findVersion("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    describe("listarPublicadasPorDisparador", () => {
      it("trae la version publicada de un workflow activo cuyo disparador matchea", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: true });
        const v = await repo.crearVersion({
          workflow_id: w.id,
          version: 1,
          grafo: grafoConDisparador("etiqueta_asignada"),
          max_pasos: 500,
          created_by: null,
        });
        await repo.publicarVersion(v.id);

        const encontradas = await repo.listarPublicadasPorDisparador("etiqueta_asignada");
        expect(encontradas.map((x) => x.id)).toEqual([v.id]);
      });

      it("no trae nada si el disparador no matchea", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: true });
        const v = await repo.crearVersion({
          workflow_id: w.id,
          version: 1,
          grafo: grafoConDisparador("etiqueta_asignada"),
          max_pasos: 500,
          created_by: null,
        });
        await repo.publicarVersion(v.id);

        expect(await repo.listarPublicadasPorDisparador("mensaje_recibido")).toEqual([]);
      });

      it("no trae la version de un workflow inactivo aunque el disparador matchee", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
        const v = await repo.crearVersion({
          workflow_id: w.id,
          version: 1,
          grafo: grafoConDisparador("etiqueta_asignada"),
          max_pasos: 500,
          created_by: null,
        });
        await repo.publicarVersion(v.id);

        expect(await repo.listarPublicadasPorDisparador("etiqueta_asignada")).toEqual([]);
      });

      it("no trae una version sin publicar aunque el workflow este activo y el disparador matchee", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: true });
        await repo.crearVersion({
          workflow_id: w.id,
          version: 1,
          grafo: grafoConDisparador("etiqueta_asignada"),
          max_pasos: 500,
          created_by: null,
        });

        expect(await repo.listarPublicadasPorDisparador("etiqueta_asignada")).toEqual([]);
      });
    });

    describe("setActivo", () => {
      it("prende y apaga sin tocar nombre ni descripción", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: "d", activo: false });

        const prendido = await repo.setActivo(w.id, true);
        expect(prendido.activo).toBe(true);
        expect(prendido.nombre).toBe("W");
        expect(prendido.descripcion).toBe("d");

        const apagado = await repo.setActivo(w.id, false);
        expect(apagado.activo).toBe(false);
      });
    });

    describe("eliminar", () => {
      it("saca el workflow de listarWorkflows", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });

        await repo.eliminar(w.id);

        expect(await repo.findWorkflow(w.id)).toBeNull();
        expect(await repo.listarWorkflows()).toEqual([]);
      });
    });

    describe("nota de la versión", () => {
      it("una versión nace sin nota", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
        const v = await repo.crearVersion({
          workflow_id: w.id,
          version: 1,
          grafo: GRAFO,
          max_pasos: 500,
          created_by: null,
        });
        expect(v.nota).toBeNull();
      });

      it("publicar con nota la guarda; publicar sin nota no la borra; una nota en blanco no la pisa", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
        const v = await repo.crearVersion({
          workflow_id: w.id,
          version: 1,
          grafo: GRAFO,
          max_pasos: 500,
          created_by: null,
        });

        expect((await repo.publicarVersion(v.id, "Arreglo del saludo")).nota).toBe(
          "Arreglo del saludo",
        );
        expect((await repo.publicarVersion(v.id)).nota).toBe("Arreglo del saludo");
        expect((await repo.publicarVersion(v.id, "   ")).nota).toBe("Arreglo del saludo");
        expect((await repo.findVersion(v.id))?.nota).toBe("Arreglo del saludo");
      });
    });

    describe("clonarVersion", () => {
      it("sin publicar: una versión nueva con el próximo número, el mismo grafo y tope, despublicada", async () => {
        const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
        const v1 = await repo.crearVersion({
          workflow_id: w.id,
          version: 1,
          grafo: GRAFO,
          max_pasos: 77,
          created_by: null,
        });
        await repo.crearVersion({
          workflow_id: w.id,
          version: 2,
          grafo: grafoConDisparador("mensaje_recibido"),
          max_pasos: 500,
          created_by: null,
        });

        const copia = await repo.clonarVersion({
          versionId: v1.id,
          publicar: false,
          nota: null,
          createdBy: null,
        });

        expect(copia.id).not.toBe(v1.id);
        expect(copia.workflow_id).toBe(w.id);
        expect(copia.version).toBe(3);
        expect(copia.grafo).toEqual(GRAFO);
        expect(copia.max_pasos).toBe(77);
        expect(copia.publicada).toBe(false);
        expect(copia.nota).toBeNull();
        expect(await repo.findVersionPublicada(w.id)).toBeNull();
      });

      it("publicando: la copia queda publicada con su nota y la versión vieja no revive", async () => {
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
          grafo: grafoConDisparador("mensaje_recibido"),
          max_pasos: 500,
          created_by: null,
        });
        await repo.publicarVersion(v2.id);

        const restaurada = await repo.clonarVersion({
          versionId: v1.id,
          publicar: true,
          nota: "Restaurada desde la versión 1",
          createdBy: null,
        });

        expect(restaurada.version).toBe(3);
        expect(restaurada.publicada).toBe(true);
        expect(restaurada.nota).toBe("Restaurada desde la versión 1");
        expect((await repo.findVersionPublicada(w.id))?.id).toBe(restaurada.id);
        expect((await repo.findVersion(v1.id))?.publicada).toBe(false);
        expect((await repo.findVersion(v2.id))?.publicada).toBe(false);
      });

      it("clonar una versión que no existe rechaza con NotFoundError", async () => {
        await expect(
          repo.clonarVersion({
            versionId: "00000000-0000-4000-8000-000000000999",
            publicar: false,
            nota: null,
            createdBy: null,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });
}
