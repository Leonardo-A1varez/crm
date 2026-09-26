import { describe, expect, it } from "vitest";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { MARCA_CORRIDA_DE_PRUEBA } from "@/types/workflows";

/**
 * `workflowId` es el workflow al que pertenece `versionId`: lo necesita
 * `contarVivasPorVersion`, que cuenta por workflow.
 */
export function runWorkflowRunsContract(
  makeRepo: () => Promise<{
    repo: WorkflowRunsRepository;
    versionId: string;
    leadId: string;
    workflowId: string;
  }>,
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

    it("registrarNoArrancada deja una corrida cancelada con el motivo, sin frenar a las que vienen", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const cortada = await repo.registrarNoArrancada(
        { versionId, leadId, sessionId: null, contexto: { $cadena: 6 } },
        "cadena cortada",
      );
      expect(cortada).toMatchObject({
        estado: "cancelado",
        pasos_ejecutados: 0,
        error: "cadena cortada",
        contexto: { $cadena: 6 },
      });
      expect(cortada.ended_at).not.toBeNull();
      expect((await repo.findRun(cortada.id))?.estado).toBe("cancelado");
      // No es una corrida viva: con política `ignorar`, la próxima arranca.
      const siguiente = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      expect(siguiente.run).not.toBeNull();
    });

    it("no deja arrancar una segunda corrida viva para el mismo lead", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      const segunda = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      expect(segunda.run).toBeNull();
      expect(segunda.motivo).toBe("ya_hay_corrida_viva");
    });

    describe("Probar queda fuera de la política de concurrencia", () => {
      const prueba = { [MARCA_CORRIDA_DE_PRUEBA]: true };

      it("una corrida de producción viva no impide probar el flujo para ese lead", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const produccion = await repo.arrancar({
          versionId,
          leadId,
          sessionId: null,
          contexto: {},
        });
        const probada = await repo.arrancar({
          versionId,
          leadId,
          sessionId: null,
          contexto: prueba,
        });
        expect(probada.motivo).toBeUndefined();
        expect(probada.run?.estado).toBe("corriendo");
        expect((await repo.findRun(produccion.run!.id))?.estado).toBe("corriendo");
      });

      it("una corrida de Probar viva no frena un disparo de producción", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        await repo.arrancar({ versionId, leadId, sessionId: null, contexto: prueba });
        const produccion = await repo.arrancar({
          versionId,
          leadId,
          sessionId: null,
          contexto: {},
        });
        expect(produccion.motivo).toBeUndefined();
        expect(produccion.run?.estado).toBe("corriendo");
      });
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

    it("una corrida fallada no se puede tomar (mismo predicado que 'cancelado')", async () => {
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

    it("cancelar deja la corrida cancelada con el motivo, sus pasos y ended_at", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.esperar(run!.id, "n3", { $cadena: 2 }, 3);
      await repo.cancelar(run!.id, "cadena cortada", 3);
      const final = await repo.findRun(run!.id);
      expect(final).toMatchObject({
        estado: "cancelado",
        error: "cadena cortada",
        pasos_ejecutados: 3,
      });
      expect(final?.ended_at).not.toBeNull();
      // Ya no es viva: con política `ignorar`, la próxima arranca.
      const siguiente = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      expect(siguiente.run).not.toBeNull();
    });

    describe("cancelarSiViva — cancelar a mano", () => {
      it("cancela una corrida viva, corriendo o esperando, y conserva sus pasos", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        await repo.esperar(run!.id, "n2", {}, 2);
        expect(await repo.cancelarSiViva(run!.id, "cancelada a mano")).toEqual({ ok: true });
        const final = await repo.findRun(run!.id);
        expect(final).toMatchObject({
          estado: "cancelado",
          error: "cancelada a mano",
          pasos_ejecutados: 2,
        });
        expect(final?.ended_at).not.toBeNull();
      });

      it("una corrida que ya terminó no se toca", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        await repo.terminar(run!.id, 1);
        expect(await repo.cancelarSiViva(run!.id, "x")).toEqual({
          ok: false,
          motivo: "corrida_no_viva",
        });
        expect((await repo.findRun(run!.id))?.estado).toBe("terminado");
      });

      it("una corrida que no existe se dice", async () => {
        const { repo } = await makeRepo();
        expect(await repo.cancelarSiViva("00000000-0000-4000-8000-000000000000", "x")).toEqual({
          ok: false,
          motivo: "corrida_no_encontrada",
        });
      });

      it("el segmento que seguía en vuelo no la resucita: esperar/terminar/fallar no pisan 'cancelado'", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        await repo.cancelarSiViva(run!.id, "cancelada a mano");
        await repo.esperar(run!.id, "n3", {}, 3);
        await repo.avanzar(run!.id, "n4", {}, 4);
        await repo.terminar(run!.id, 5);
        await repo.fallar(run!.id, "otra cosa", 5);
        await repo.cancelar(run!.id, "otro motivo", 5);
        expect(await repo.findRun(run!.id)).toMatchObject({
          estado: "cancelado",
          error: "cancelada a mano",
          pasos_ejecutados: 0,
        });
      });
    });

    it("fallarSiVivo marca fallado una corrida corriendo y devuelve true", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      const marcado = await repo.fallarSiVivo(run!.id, "agotados los reintentos", 0);
      expect(marcado).toBe(true);
      const final = await repo.findRun(run!.id);
      expect(final?.estado).toBe("fallado");
      expect(final?.error).toBe("agotados los reintentos");
      expect(final?.ended_at).not.toBeNull();
    });

    it("fallarSiVivo marca fallado una corrida esperando y devuelve true", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.esperar(run!.id, "espera-cotizacion", { pedido: 1 }, 2);
      const marcado = await repo.fallarSiVivo(run!.id, "agotados los reintentos", 2);
      expect(marcado).toBe(true);
      const final = await repo.findRun(run!.id);
      expect(final?.estado).toBe("fallado");
    });

    it("fallarSiVivo NO toca una corrida ya terminada -- no la resucita", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.terminar(run!.id, 3);
      const marcado = await repo.fallarSiVivo(run!.id, "reintento tardío", 3);
      expect(marcado).toBe(false);
      const final = await repo.findRun(run!.id);
      expect(final?.estado).toBe("terminado");
      expect(final?.error).toBeNull();
    });

    it("fallarSiVivo NO toca una corrida ya fallada -- no pisa el error original", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.fallar(run!.id, "error original", 1);
      const marcado = await repo.fallarSiVivo(run!.id, "reintento tardío", 1);
      expect(marcado).toBe(false);
      const final = await repo.findRun(run!.id);
      expect(final?.error).toBe("error original");
    });

    it("fallarSiVivo con desdePaso desactualizado (otro segmento ya avanzó) devuelve false", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.avanzar(run!.id, "b", {}, 5);
      const marcado = await repo.fallarSiVivo(run!.id, "reintento tardío", 0);
      expect(marcado).toBe(false);
      const final = await repo.findRun(run!.id);
      expect(final?.estado).toBe("corriendo");
    });

    it("fallarSiVivo con un runId inexistente devuelve false", async () => {
      const { repo } = await makeRepo();
      const marcado = await repo.fallarSiVivo(
        "00000000-0000-4000-8000-000000000999",
        "no existe",
        0,
      );
      expect(marcado).toBe(false);
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

    describe("reanudar desde el fallo", () => {
      /** disparador (1, ok) -> mensaje (2, falló): la corrida queda fallada en el paso 2. */
      async function falladaEnElPaso2(
        repo: WorkflowRunsRepository,
        versionId: string,
        leadId: string,
        contexto: Record<string, unknown> = {},
      ) {
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto });
        await repo.registrarPaso(run!.id, {
          nodo_id: "d",
          orden: 1,
          entrada: null,
          salida: null,
          error: null,
        });
        await repo.registrarPaso(run!.id, {
          nodo_id: "m",
          orden: 2,
          entrada: null,
          salida: null,
          error: "la ventana de 24 h de Meta está cerrada",
        });
        await repo.fallar(run!.id, "la ventana de 24 h de Meta está cerrada", 2);
        return run!;
      }

      it("la deja esperando en el nodo que falló, nunca en el disparador, con su orden como pasos", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const run = await falladaEnElPaso2(repo, versionId, leadId);

        expect(await repo.reanudar(run.id)).toEqual({ ok: true, desdePaso: 2, nodoId: "m" });

        const reanudada = await repo.findRun(run.id);
        expect(reanudada?.estado).toBe("esperando");
        expect(reanudada?.nodo_actual).toBe("m");
        expect(reanudada?.pasos_ejecutados).toBe(2);
        expect(reanudada?.error).toBeNull();
        expect(reanudada?.ended_at).toBeNull();
        // El evento de reanudación trae ese desdePaso: la CAS del segmento la toma.
        expect(await repo.tomarSegmento(run.id, 2)).not.toBeNull();
      });

      it("reanudar dos veces: la segunda ya no la encuentra fallada", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const run = await falladaEnElPaso2(repo, versionId, leadId);
        await repo.reanudar(run.id);
        expect(await repo.reanudar(run.id)).toEqual({ ok: false, motivo: "corrida_no_fallada" });
      });

      it("una corrida que no falló no se reanuda", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        expect(await repo.reanudar(run!.id)).toEqual({ ok: false, motivo: "corrida_no_fallada" });
      });

      it("una corrida que falló sin un paso fallado no tiene desde dónde reanudar", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        await repo.registrarPaso(run!.id, {
          nodo_id: "d",
          orden: 1,
          entrada: null,
          salida: null,
          error: null,
        });
        await repo.fallar(run!.id, "tope de 1 pasos alcanzado", 1);
        expect(await repo.reanudar(run!.id)).toEqual({ ok: false, motivo: "sin_paso_fallado" });
      });

      it("una corrida de Probar no se reanuda en producción", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const run = await falladaEnElPaso2(repo, versionId, leadId, {
          [MARCA_CORRIDA_DE_PRUEBA]: true,
        });
        expect(await repo.reanudar(run.id)).toEqual({ ok: false, motivo: "corrida_de_prueba" });
        expect((await repo.findRun(run.id))?.estado).toBe("fallado");
      });

      it("no la reanuda si ya hay otra corrida viva del mismo workflow para el lead", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const run = await falladaEnElPaso2(repo, versionId, leadId);
        await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        expect(await repo.reanudar(run.id)).toEqual({ ok: false, motivo: "ya_hay_corrida_viva" });
      });

      it("una corrida inexistente", async () => {
        const { repo } = await makeRepo();
        expect(await repo.reanudar("00000000-0000-4000-8000-000000000999")).toEqual({
          ok: false,
          motivo: "corrida_no_encontrada",
        });
      });
    });

    describe("relanzar desde el principio", () => {
      it("arranca una corrida nueva de la misma versión, lead y contexto; la fallada queda como estaba", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({
          versionId,
          leadId,
          sessionId: null,
          contexto: { lead: { etapa: "cotizado" } },
        });
        await repo.fallar(run!.id, "boom", 1);

        const { run: nueva, motivo } = await repo.relanzar(run!.id);

        expect(motivo).toBeUndefined();
        expect(nueva?.id).not.toBe(run!.id);
        expect(nueva?.workflow_version_id).toBe(versionId);
        expect(nueva?.lead_id).toBe(leadId);
        expect(nueva?.contexto).toEqual({ lead: { etapa: "cotizado" } });
        expect(nueva?.estado).toBe("corriendo");
        expect(nueva?.pasos_ejecutados).toBe(0);
        expect((await repo.findRun(run!.id))?.estado).toBe("fallado");
      });

      it("sólo relanza corridas falladas", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        await repo.terminar(run!.id, 2);
        expect(await repo.relanzar(run!.id)).toEqual({
          run: null,
          motivo: "corrida_no_fallada",
          cancelados: [],
        });
      });

      it("una corrida de Probar no se relanza en producción", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({
          versionId,
          leadId,
          sessionId: null,
          contexto: { [MARCA_CORRIDA_DE_PRUEBA]: true },
        });
        await repo.fallar(run!.id, "boom", 1);
        expect(await repo.relanzar(run!.id)).toEqual({
          run: null,
          motivo: "corrida_de_prueba",
          cancelados: [],
        });
      });

      it("respeta la política de concurrencia: con otra corrida viva no arranca", async () => {
        const { repo, versionId, leadId } = await makeRepo();
        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        await repo.fallar(run!.id, "boom", 1);
        await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        expect(await repo.relanzar(run!.id)).toEqual({
          run: null,
          motivo: "ya_hay_corrida_viva",
          cancelados: [],
        });
      });

      it("una corrida inexistente", async () => {
        const { repo } = await makeRepo();
        expect(await repo.relanzar("00000000-0000-4000-8000-000000000999")).toEqual({
          run: null,
          motivo: "corrida_no_encontrada",
          cancelados: [],
        });
      });
    });

    describe("contarVivasPorVersion", () => {
      it("cuenta sólo las corridas vivas del workflow, por versión", async () => {
        const { repo, versionId, workflowId } = await makeRepo();
        await repo.arrancar({
          versionId,
          leadId: "00000000-0000-4000-8000-00000000000a",
          sessionId: null,
          contexto: {},
        });
        const { run: esperando } = await repo.arrancar({
          versionId,
          leadId: "00000000-0000-4000-8000-00000000000b",
          sessionId: null,
          contexto: {},
        });
        await repo.esperar(esperando!.id, "e", {}, 1);
        const { run: terminada } = await repo.arrancar({
          versionId,
          leadId: "00000000-0000-4000-8000-00000000000c",
          sessionId: null,
          contexto: {},
        });
        await repo.terminar(terminada!.id, 1);

        expect(await repo.contarVivasPorVersion(workflowId)).toEqual([{ versionId, cantidad: 2 }]);
      });

      it("sin corridas vivas, la lista vacía", async () => {
        const { repo, workflowId } = await makeRepo();
        expect(await repo.contarVivasPorVersion(workflowId)).toEqual([]);
      });
    });

    // Lo que mira el interceptor antes de silenciar al agente: con política
    // `ignorar`, una corrida viva del flujo para el lead no deja arrancar otra.
    // Mismo predicado que `arrancar_workflow_run`.
    describe("hayCorridaViva", () => {
      it("corriendo o esperando cuenta; terminada no", async () => {
        const { repo, versionId, leadId, workflowId } = await makeRepo();
        expect(await repo.hayCorridaViva(workflowId, leadId)).toBe(false);

        const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
        expect(await repo.hayCorridaViva(workflowId, leadId)).toBe(true);
        await repo.esperar(run!.id, "e", {}, 1);
        expect(await repo.hayCorridaViva(workflowId, leadId)).toBe(true);
        await repo.terminar(run!.id, 1);
        expect(await repo.hayCorridaViva(workflowId, leadId)).toBe(false);
      });

      it("es por lead: la corrida viva de otro lead no cuenta", async () => {
        const { repo, versionId, leadId, workflowId } = await makeRepo();
        await repo.arrancar({
          versionId,
          leadId: "00000000-0000-4000-8000-00000000000d",
          sessionId: null,
          contexto: {},
        });
        expect(await repo.hayCorridaViva(workflowId, leadId)).toBe(false);
      });

      it("una corrida de Probar viva no cuenta: no frena un disparo de producción", async () => {
        const { repo, versionId, leadId, workflowId } = await makeRepo();
        await repo.arrancar({
          versionId,
          leadId,
          sessionId: null,
          contexto: { [MARCA_CORRIDA_DE_PRUEBA]: true },
        });
        expect(await repo.hayCorridaViva(workflowId, leadId)).toBe(false);
      });
    });
  });
}
