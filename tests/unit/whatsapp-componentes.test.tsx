import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AreaWhatsApp } from "@/components/whatsapp/AreaWhatsApp";
import { BotonAbrirWhatsApp } from "@/components/whatsapp/BotonAbrirWhatsApp";
import {
  crmEscritorioFake,
  ResizeObserverMock,
  resizeObserver,
} from "../helpers/crm-escritorio-fake";

afterEach(() => {
  cleanup();
  delete window.crmEscritorio;
  resizeObserver.callback = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AreaWhatsApp", () => {
  test("sin window.crmEscritorio no revienta ni reporta nada", () => {
    render(<AreaWhatsApp />);

    expect(screen.getByText("Cargando WhatsApp Web…")).toBeTruthy();
  });

  test("con window.crmEscritorio reporta el rect al montar, en cada resize y null al desmontar", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const crm = crmEscritorioFake();
    window.crmEscritorio = crm;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      top: 20,
      left: 10,
      right: 310,
      bottom: 420,
      toJSON() {
        return {};
      },
    });

    const { unmount } = render(<AreaWhatsApp />);

    expect(crm.reportarAreaWhatsApp).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });

    vi.mocked(crm.reportarAreaWhatsApp).mockClear();
    resizeObserver.callback?.();
    expect(crm.reportarAreaWhatsApp).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });

    vi.mocked(crm.reportarAreaWhatsApp).mockClear();
    fireEvent(window, new Event("resize"));
    expect(crm.reportarAreaWhatsApp).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });

    unmount();
    expect(crm.reportarAreaWhatsApp).toHaveBeenLastCalledWith(null);
  });

  test("un scroll de un ancestro del hueco vuelve a reportar; el de un hermano no", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const crm = crmEscritorioFake();
    window.crmEscritorio = crm;

    const { container } = render(
      <div data-testid="ancestro">
        <AreaWhatsApp />
        <div data-testid="hermano" />
      </div>,
    );
    vi.mocked(crm.reportarAreaWhatsApp).mockClear();

    fireEvent.scroll(container.querySelector('[data-testid="hermano"]')!);
    expect(crm.reportarAreaWhatsApp).not.toHaveBeenCalled();

    fireEvent.scroll(container.querySelector('[data-testid="ancestro"]')!);
    expect(crm.reportarAreaWhatsApp).toHaveBeenCalledTimes(1);
  });
});

describe("BotonAbrirWhatsApp", () => {
  test("en la app de escritorio, el click pide mostrarWhatsApp y no deja error si sale bien", async () => {
    const crm = crmEscritorioFake({ mostrarWhatsApp: vi.fn().mockResolvedValue({ ok: true }) });
    window.crmEscritorio = crm;
    render(<BotonAbrirWhatsApp />);

    const boton = await screen.findByRole("button", { name: "Abrir WhatsApp Web" });
    fireEvent.click(boton);

    await waitFor(() => expect(crm.mostrarWhatsApp).toHaveBeenCalledWith({ recargar: true }));
    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Abrir WhatsApp Web" }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
  });

  test("si mostrarWhatsApp falla, muestra el motivo en texto humano", async () => {
    const crm = crmEscritorioFake({
      mostrarWhatsApp: vi.fn().mockResolvedValue({ ok: false, motivo: "no_disponible" }),
    });
    window.crmEscritorio = crm;
    render(<BotonAbrirWhatsApp />);

    const boton = await screen.findByRole("button", { name: "Abrir WhatsApp Web" });
    fireEvent.click(boton);

    expect(
      await screen.findByText("WhatsApp Web no está disponible en este momento."),
    ).toBeTruthy();
  });

  test("un motivo sin traducción se muestra tal cual, sin inventar texto", async () => {
    const crm = crmEscritorioFake({
      mostrarWhatsApp: vi
        .fn()
        .mockResolvedValue({ ok: false, motivo: "motivo_de_prueba_sin_mapear" }),
    });
    window.crmEscritorio = crm;
    render(<BotonAbrirWhatsApp />);

    const boton = await screen.findByRole("button", { name: "Abrir WhatsApp Web" });
    fireEvent.click(boton);

    expect(await screen.findByText("motivo_de_prueba_sin_mapear")).toBeTruthy();
  });
});
