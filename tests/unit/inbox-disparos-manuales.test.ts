import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Los cambios que una persona hace a mano desde el inbox también disparan los
 * flujos: poner o sacar una etiqueta, mover la etapa. Sólo si el cambio pasó de
 * verdad — reasignar una etiqueta que ya estaba no es "se le puso una etiqueta".
 */

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  asignarEtiqueta: vi.fn(),
  quitarEtiqueta: vi.fn(),
  moverEtapa: vi.fn(),
  emitirDisparoWorkflow: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/supabase-ssr", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/server/bootstrap/inbox-bootstrap", () => ({
  getInboxServiceForRequest: async () => ({
    getConversation: mocks.getConversation,
    asignarEtiqueta: mocks.asignarEtiqueta,
    quitarEtiqueta: mocks.quitarEtiqueta,
    moverEtapa: mocks.moverEtapa,
  }),
}));
vi.mock("@/server/bootstrap/workflows-bootstrap", () => ({
  emitirDisparoWorkflow: mocks.emitirDisparoWorkflow,
}));

const { asignarEtiquetaAction } =
  await import("@/app/(panel)/inbox/_actions/asignar-etiqueta.action");
const { quitarEtiquetaAction } =
  await import("@/app/(panel)/inbox/_actions/quitar-etiqueta.action");
const { moverEtapaAction } = await import("@/app/(panel)/inbox/_actions/mover-etapa.action");

const LEAD_ID = "7f3e2d1c-0b9a-4876-8543-210fedcba987";
const TAG_ID = "0b9a4c1e-6c1d-4f7e-9a53-1f2d3c4b5a61";
const SESION_ID = "5e551e55-aaaa-4bbb-8ccc-dddddddddddd";

function sesion(etapa: string) {
  return { id: SESION_ID, current_stage: etapa, producto_cotizado_id: null, precio_cotizado: null };
}

function vista(opciones: { tags?: string[]; etapa?: string } = {}) {
  return {
    lead: { id: LEAD_ID, nombre: "Ana" },
    session: sesion(opciones.etapa ?? "identificando"),
    canalActivo: "wa",
    tags: (opciones.tags ?? []).map((id) => ({ id })),
  };
}

beforeEach(() => {
  // `reset` y no `clear`: un `mockRejectedValue` de un test no puede filtrarse al siguiente.
  vi.resetAllMocks();
  mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
  mocks.emitirDisparoWorkflow.mockResolvedValue(undefined);
});

describe("asignarEtiquetaAction", () => {
  test("una etiqueta que el lead no tenía dispara 'etiqueta_asignada' con la etiqueta", async () => {
    mocks.getConversation.mockResolvedValue(vista());

    const r = await asignarEtiquetaAction({ leadId: LEAD_ID, tagId: TAG_ID });

    expect(r).toEqual({ ok: true });
    expect(mocks.emitirDisparoWorkflow).toHaveBeenCalledTimes(1);
    const disparo = mocks.emitirDisparoWorkflow.mock.calls[0]![0];
    expect(disparo.id).toMatch(
      new RegExp(`^workflow-disparo:etiqueta-asignada-manual:${LEAD_ID}:${TAG_ID}:`),
    );
    expect(disparo.data).toEqual({
      disparador: "etiqueta_asignada",
      leadId: LEAD_ID,
      leadSessionId: SESION_ID,
      contexto: {
        lead: { etapa: "identificando", nombre: "Ana", canal: "wa" },
        sesion: { tiene_cotizacion: false },
      },
      datos: { tagId: TAG_ID },
    });
  });

  test("una etiqueta que el lead ya tenía no dispara", async () => {
    mocks.getConversation.mockResolvedValue(vista({ tags: [TAG_ID] }));

    const r = await asignarEtiquetaAction({ leadId: LEAD_ID, tagId: TAG_ID });

    expect(r).toEqual({ ok: true });
    expect(mocks.asignarEtiqueta).toHaveBeenCalled();
    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });

  test("si asignar falla, no dispara nada", async () => {
    mocks.getConversation.mockResolvedValue(vista());
    mocks.asignarEtiqueta.mockRejectedValue(new Error("boom"));

    const r = await asignarEtiquetaAction({ leadId: LEAD_ID, tagId: TAG_ID });

    expect(r.ok).toBe(false);
    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });

  test("si Inngest no recibe el disparo, la etiqueta queda y lo dice", async () => {
    mocks.getConversation.mockResolvedValue(vista());
    mocks.emitirDisparoWorkflow.mockRejectedValue(new Error("fetch failed"));

    const r = await asignarEtiquetaAction({ leadId: LEAD_ID, tagId: TAG_ID });

    expect(mocks.asignarEtiqueta).toHaveBeenCalled();
    expect(r).toEqual({
      ok: false,
      error: "La etiqueta quedó puesta, pero los flujos no se enteraron. Avisá al administrador.",
    });
  });
});

describe("quitarEtiquetaAction", () => {
  test("sacar una etiqueta que tenía dispara 'etiqueta_removida'", async () => {
    mocks.getConversation.mockResolvedValue(vista({ tags: [TAG_ID] }));

    const r = await quitarEtiquetaAction({ leadId: LEAD_ID, tagId: TAG_ID });

    expect(r).toEqual({ ok: true });
    const disparo = mocks.emitirDisparoWorkflow.mock.calls[0]![0];
    expect(disparo.id).toMatch(
      new RegExp(`^workflow-disparo:etiqueta-removida-manual:${LEAD_ID}:${TAG_ID}:`),
    );
    expect(disparo.data).toMatchObject({
      disparador: "etiqueta_removida",
      leadId: LEAD_ID,
      datos: { tagId: TAG_ID },
    });
  });

  test("sacar una que no estaba no dispara", async () => {
    mocks.getConversation.mockResolvedValue(vista());

    await quitarEtiquetaAction({ leadId: LEAD_ID, tagId: TAG_ID });

    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });
});

describe("moverEtapaAction", () => {
  test("mover la etapa dispara 'etapa_cambiada' con la de antes y la nueva", async () => {
    mocks.getConversation.mockResolvedValue(vista({ etapa: "identificando" }));
    mocks.moverEtapa.mockResolvedValue(sesion("cotizado"));

    const r = await moverEtapaAction({ leadId: LEAD_ID, sessionId: SESION_ID, etapa: "cotizado" });

    expect(r).toEqual({ ok: true });
    const disparo = mocks.emitirDisparoWorkflow.mock.calls[0]![0];
    expect(disparo.id).toMatch(new RegExp(`^workflow-disparo:etapa-manual:${SESION_ID}:cotizado:`));
    expect(disparo.data).toMatchObject({
      disparador: "etapa_cambiada",
      leadId: LEAD_ID,
      leadSessionId: SESION_ID,
      contexto: { lead: { etapa: "cotizado" } },
      datos: { etapaAnterior: "identificando", etapaNueva: "cotizado" },
    });
  });

  test("dejarla en la misma etapa no dispara", async () => {
    mocks.getConversation.mockResolvedValue(vista({ etapa: "cotizado" }));
    mocks.moverEtapa.mockResolvedValue(sesion("cotizado"));

    await moverEtapaAction({ leadId: LEAD_ID, sessionId: SESION_ID, etapa: "cotizado" });

    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });

  test("una sesión que no es la activa del lead no dispara con datos ajenos", async () => {
    mocks.getConversation.mockResolvedValue({ ...vista(), session: null });
    mocks.moverEtapa.mockResolvedValue(sesion("cotizado"));

    await moverEtapaAction({ leadId: LEAD_ID, sessionId: SESION_ID, etapa: "cotizado" });

    expect(mocks.emitirDisparoWorkflow).not.toHaveBeenCalled();
  });
});
