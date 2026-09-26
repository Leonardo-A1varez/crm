import { describe, expect, it } from "vitest";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryWorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { Grafo, NodoTipo } from "@/types/workflows";

/**
 * Lo que la tarjeta de `/workflows` necesita del disparador: su tipo, para el
 * ícono (de la última versión, que es lo que se ve al abrir), y si la versión
 * PUBLICADA arranca a mano, que es lo único que habilita «Disparar ahora».
 */

function grafoCon(tipo: NodoTipo): Grafo {
  return {
    nodos: [
      { id: "n1", tipo, config: {}, posicion: { x: 0, y: 0 } },
      { id: "n2", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 144 } },
    ],
    aristas: [{ desde: "n1", hasta: "n2", puerto: "salida" }],
  };
}

function build() {
  const workflows = new InMemoryWorkflowsRepository();
  return new DefaultWorkflowsAdminService({
    workflows,
    workflowRuns: new InMemoryWorkflowRunsRepository(),
    leads: new InMemoryLeadsRepository(),
  });
}

describe("listarConResumen: el disparador", () => {
  it("sin versiones no hay disparador ni disparo manual", async () => {
    const svc = build();
    await svc.crear({ nombre: "Vacío", descripcion: null });
    const [r] = await svc.listarConResumen();
    expect(r?.disparadorTipo).toBeNull();
    expect(r?.disparoManualPublicado).toBe(false);
  });

  it("el tipo sale de la última versión; el disparo manual, sólo de la publicada", async () => {
    const svc = build();
    const w = await svc.crear({ nombre: "Manual", descripcion: null });
    const v1 = await svc.guardarVersion({
      workflowId: w.id,
      grafo: grafoCon("trigger_manual"),
      maxPasos: 500,
      userId: null,
    });
    // Guardada sin publicar: el ícono ya dice Manual, pero no se puede disparar.
    let [r] = await svc.listarConResumen();
    expect(r?.disparadorTipo).toBe("trigger_manual");
    expect(r?.disparoManualPublicado).toBe(false);

    await svc.publicar(v1.id);
    [r] = await svc.listarConResumen();
    expect(r?.disparoManualPublicado).toBe(true);

    // Un borrador nuevo con otro disparador cambia el ícono y no el disparo:
    // lo que corre sigue siendo la publicada.
    await svc.guardarVersion({
      workflowId: w.id,
      grafo: grafoCon("trigger_lead_creado"),
      maxPasos: 500,
      userId: null,
    });
    [r] = await svc.listarConResumen();
    expect(r?.disparadorTipo).toBe("trigger_lead_creado");
    expect(r?.disparoManualPublicado).toBe(true);
  });
});
