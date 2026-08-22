import { describe, expect, it } from "vitest";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";

export function runWorkflowRunsContract(
  makeRepo: () => Promise<{ repo: WorkflowRunsRepository; versionId: string; leadId: string }>,
) {
  describe("WorkflowRunsRepository", () => {
    it("arranca una corrida nueva en 'corriendo', paso 0", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run, motivo } = await repo.arrancar({
        versionId,
        leadId,
        sessionId: null,
        contexto: { origen: "test" },
      });
      expect(motivo).toBeUndefined();
      expect(run).not.toBeNull();
      expect(run?.estado).toBe("corriendo");
      expect(run?.pasos_ejecutados).toBe(0);
      expect(run?.contexto).toEqual({ origen: "test" });
    });

    it("no deja arrancar una segunda corrida viva para el mismo lead", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      const segunda = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      expect(segunda.run).toBeNull();
      expect(segunda.motivo).toBe("ya_hay_corrida_viva");
    });

    it("tomarSegmento es un compare-and-swap: el segundo intento no matchea", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      expect(run).not.toBeNull();

      const primero = await repo.tomarSegmento(run!.id, 0);
      expect(primero).not.toBeNull();

      await repo.avanzar(run!.id, "a", {}, 3);

      // El evento reentregado trae desdePaso 0 y ya no matchea: no reejecuta.
      const reentregado = await repo.tomarSegmento(run!.id, 0);
      expect(reentregado).toBeNull();

      // El desdePaso correcto sí matchea.
      const correcto = await repo.tomarSegmento(run!.id, 3);
      expect(correcto).not.toBeNull();
      expect(correcto?.estado).toBe("corriendo");
    });

    it("tomarSegmento con un runId inexistente devuelve null", async () => {
      const { repo } = await makeRepo();
      expect(await repo.tomarSegmento("00000000-0000-4000-8000-000000000999", 0)).toBeNull();
    });

    it("una corrida cancelada no se puede tomar", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.fallar(run!.id, "cancelada a mano", 0);
      expect(await repo.tomarSegmento(run!.id, 0)).toBeNull();
    });

    it("esperar deja la corrida viva pero pausada", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.esperar(run!.id, "espera-cotizacion", { pedido: 1 }, 2);
      const esperando = await repo.findRun(run!.id);
      expect(esperando?.estado).toBe("esperando");
      expect(esperando?.nodo_actual).toBe("espera-cotizacion");
      expect(esperando?.pasos_ejecutados).toBe(2);

      // Una corrida esperando sigue viva: la CAS la puede tomar.
      expect(await repo.tomarSegmento(run!.id, 2)).not.toBeNull();
    });

    it("terminar deja ended_at y estado coherentes", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.terminar(run!.id, 5);
      const final = await repo.findRun(run!.id);
      expect(final?.estado).toBe("terminado");
      expect(final?.ended_at).not.toBeNull();
      expect(final?.pasos_ejecutados).toBe(5);
    });

    it("fallar deja el error y ended_at coherentes", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.fallar(run!.id, "el tool tardó demasiado", 1);
      const final = await repo.findRun(run!.id);
      expect(final?.estado).toBe("fallado");
      expect(final?.error).toBe("el tool tardó demasiado");
      expect(final?.ended_at).not.toBeNull();
    });

    it("registrarPaso no revienta contra una corrida existente", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await expect(
        repo.registrarPaso(run!.id, {
          nodo_id: "d",
          orden: 0,
          entrada: null,
          salida: { ok: true },
          error: null,
        }),
      ).resolves.not.toThrow();
    });

    it("findRun de un id inexistente devuelve null", async () => {
      const { repo } = await makeRepo();
      expect(await repo.findRun("00000000-0000-4000-8000-000000000999")).toBeNull();
    });
  });
}
