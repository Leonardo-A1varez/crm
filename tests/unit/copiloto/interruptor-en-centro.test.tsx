import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CentroConversacion } from "@/components/inbox/CentroConversacion";
import { InterruptorModo } from "@/components/inbox/copiloto/InterruptorModo";
import { crmEscritorioFake, ResizeObserverMock } from "../../helpers/crm-escritorio-fake";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const TEL = "593979932363";
const CLAVE_U1 = "crm:inbox:vista-centro:usuario-1";

afterEach(() => {
  cleanup();
  delete window.crmEscritorio;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function conEscritorio() {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  window.crmEscritorio = crmEscritorioFake();
}

const interruptor = () => (
  <InterruptorModo
    leadId="lead-a"
    conversacionId="conv-a"
    override={null}
    modoEfectivo="copiloto"
    onCambiar={vi.fn().mockResolvedValue({ ok: true })}
  />
);

/**
 * Igual que la página: el mismo interruptor va dentro del hilo (junto a "IA
 * activa", en el encabezado) y como prop del centro (en la barra de WhatsApp
 * Web). Según el modo solo uno de los dos queda montado.
 */
function montar(conInterruptor: boolean) {
  render(
    <CentroConversacion
      leadId="lead-a"
      usuarioId="usuario-1"
      telefono={TEL}
      interruptor={conInterruptor ? interruptor() : null}
      hilo={<header data-testid="encabezado-hilo">{conInterruptor ? interruptor() : null}</header>}
    />,
  );
}

const todos = () => screen.queryAllByRole("combobox", { name: "Modo de respuesta" });

describe("el interruptor de modo del copiloto en el centro del Inbox", () => {
  it("en WhatsApp Web hay uno solo y está en la barra, no en el encabezado del hilo", async () => {
    conEscritorio();
    montar(true);
    await act(async () => {});

    expect(todos()).toHaveLength(1);
    expect(screen.queryByTestId("encabezado-hilo")).toBeNull();
    const barra = screen.getByRole("group", {
      name: "Qué mostrar de la conversación",
    }).parentElement!;
    expect(barra.contains(todos()[0]!)).toBe(true);
  });

  it("en Hilo del CRM hay uno solo y está en el encabezado, no en la barra", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    conEscritorio();
    montar(true);
    await act(async () => {});

    expect(todos()).toHaveLength(1);
    expect(screen.getByTestId("encabezado-hilo").contains(todos()[0]!)).toBe(true);
  });

  it("al cambiar de vista el interruptor se muda y nunca quedan dos", async () => {
    conEscritorio();
    montar(true);
    await act(async () => {});
    expect(todos()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Hilo del CRM" }));
    await waitFor(() => expect(screen.getByTestId("encabezado-hilo")).toBeTruthy());
    expect(todos()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "WhatsApp Web" }));
    await waitFor(() => expect(screen.queryByTestId("encabezado-hilo")).toBeNull());
    expect(todos()).toHaveLength(1);
  });

  it("en el navegador (sin app de escritorio) hay uno solo, en el encabezado del hilo", async () => {
    montar(true);
    await act(async () => {});

    expect(todos()).toHaveLength(1);
    expect(screen.getByTestId("encabezado-hilo").contains(todos()[0]!)).toBe(true);
  });

  it("en Instagram y Messenger (sin interruptor) no aparece en ningún modo", async () => {
    conEscritorio();
    montar(false);
    await act(async () => {});
    expect(todos()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Hilo del CRM" }));
    await waitFor(() => expect(screen.getByTestId("encabezado-hilo")).toBeTruthy());
    expect(todos()).toHaveLength(0);
  });
});
