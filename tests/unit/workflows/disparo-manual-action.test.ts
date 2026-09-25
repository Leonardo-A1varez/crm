import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotFoundError } from "@/lib/errors";
import type { Grafo, NodoTipo } from "@/types/workflows";

const mocks = vi.hoisted(() => ({
  getCurrentRol: vi.fn(),
  emitirDisparoWorkflow: vi.fn(),
  detalle: vi.fn(),
  getConversation: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({ getCurrentRol: mocks.getCurrentRol }));
vi.mock("@/server/bootstrap/workflows-bootstrap", () => ({
  getWorkflowsAdminServiceForRequest: async () => ({ detalle: mocks.detalle }),
  emitirDisparoWorkflow: mocks.emitirDisparoWorkflow,
}));
vi.mock("@/server/bootstrap/inbox-bootstrap", () => ({
  getInboxServiceForRequest: async () => ({ getConversation: mocks.getConversation }),
}));

const { dispararWorkflowManualAction } =
  await import("@/app/(panel)/workflows/_actions/disparo-manual.actions");

const WORKFLOW_ID = "0b9a4c1e-6c1d-4f7e-9a53-1f2d3c4b5a61";
const LEAD_ID = "7f3e2d1c-0b9a-4876-8543-210fedcba987";
const SOLICITUD_ID = "c0ffee00-1234-4abc-8def-0123456789ab";
const SESION_ID = "5e551e55-aaaa-4bbb-8ccc-dddddddddddd";

function grafo(tipo: NodoTipo): Grafo {
  return {
    nodos: [
      { id: "t", tipo, config: {}, posicion: { x: 0, y: 0 } },
      { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [{ desde: "t", hasta: "fin", puerto: "salida" }],
  };
}

function detalleCon(opciones: { activo?: boolean; tipo?: NodoTipo; publicada?: boolean } = {}) {
  return {
    workflow: { id: WORKFLOW_ID, nombre: "Seguimiento", activo: opciones.activo ?? true },
    versiones: [
      {
        id: "v1",
        workflow_id: WORKFLOW_ID,
        version: 1,
        publicada: opciones.publicada ?? true,
        grafo: grafo(opciones.tipo ?? "trigger_manual"),
      },
    ],
  };
}

function vista() {
  return {
    lead: { id: LEAD_ID, nombre: "Ana", canal_origen: "wa" },
    session: {
      id: SESION_ID,
      current_stage: "cotizado",
      producto_cotizado_id: null,
      precio_cotizado: 1200,
    },
    canalActivo: "wa",
  };
}

const entrada = { workflowId: WORKFLOW_ID, leadId: LEAD_ID, solicitudId: SOLICITUD_ID };

describe("dispararWorkflowManualAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentRol.mockResolvedValue("admin");
    mocks.detalle.mockResolvedValue(detalleCon());
    mocks.getConversation.mockResolvedValue(vista());
    mocks.emitirDisparoWorkflow.mockResolvedValue(undefined);
  });

  test("dispara el flujo para el lead, con el contexto que sembraría cualquier disparo", async () => {
    const r = await dispararWorkflowManualAction(entrada);

    expect(r).toEqual({ ok: true });
    expect(mocks.emitirDisparoWorkflow).toHaveBeenCalledWith({
      // Un click es un disparo: el mismo click reenviado no arranca dos corridas.
      id: `workflow-disparo:manual:${WORKFLOW_ID}:${LEAD_ID}:${SOLICITUD_ID}`,
      data: {
        disparador: "manual",
        workflowId: WORKFLOW_ID,
        leadId: LEAD_ID,
        leadSessionId: SESION_ID,
        contexto: {
          lead: { etapa: "cotizado", nombre: "Ana", canal: "wa" },
          sesion: { tiene_cotizacion: true },
        },
      },
    });
  });

  test("una entrada que no parsea no llega a ningún lado", async () => {
    const r = await dispararWorkflowManualAction({ ...entrada, leadId: "no-es-uuid" });

    expect(r.ok).toBe(false);
    expect(mocks.getCurrentRol).not.toHaveBeenCalled();
    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });

  test("sólo un admin puede dispararlo", async () => {
    mocks.getCurrentRol.mockResolvedValue("vendedor");

    const r = await dispararWorkflowManualAction(entrada);

    expect(r).toEqual({ ok: false, error: "Solo un administrador puede hacer esto." });
    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });

  test.each([
    ["no existe", null, "El flujo no existe."],
    [
      "está pausado",
      detalleCon({ activo: false }),
      "El flujo está pausado: reanudalo para dispararlo.",
    ],
    [
      "no tiene versión publicada",
      detalleCon({ publicada: false }),
      "El flujo no tiene una versión publicada.",
    ],
    [
      "tiene otro disparador",
      detalleCon({ tipo: "trigger_mensaje" }),
      "Este flujo no se dispara a mano: su disparador es otro.",
    ],
  ])("un flujo que %s no se dispara y lo dice", async (_caso, detalle, mensaje) => {
    mocks.detalle.mockResolvedValue(detalle);

    const r = await dispararWorkflowManualAction(entrada);

    expect(r).toEqual({ ok: false, error: mensaje });
    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });

  test("un lead que no existe no se dispara", async () => {
    mocks.getConversation.mockRejectedValue(new NotFoundError("lead", "lead", LEAD_ID));

    const r = await dispararWorkflowManualAction(entrada);

    expect(r).toEqual({ ok: false, error: "El lead no existe." });
    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });

  test("si Inngest no recibe el disparo, lo dice en vez de dar por hecho que corrió", async () => {
    mocks.emitirDisparoWorkflow.mockRejectedValue(new Error("fetch failed"));

    const r = await dispararWorkflowManualAction(entrada);

    expect(r).toEqual({ ok: false, error: "No se pudo disparar el flujo." });
  });
});
