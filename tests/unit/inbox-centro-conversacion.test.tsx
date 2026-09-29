import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CentroConversacion } from "@/components/inbox/CentroConversacion";
import { crmEscritorioFake, ResizeObserverMock } from "../helpers/crm-escritorio-fake";

const TEL_A = "593979932363";
const TEL_B = "5491155551234";
const CLAVE_U1 = "crm:inbox:vista-centro:usuario-1";

afterEach(() => {
  cleanup();
  delete window.crmEscritorio;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function conEscritorio(overrides?: Parameters<typeof crmEscritorioFake>[0]) {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  const crm = crmEscritorioFake(overrides);
  window.crmEscritorio = crm;
  return crm;
}

const hilo = <p>hilo del CRM</p>;

function centro(props: { leadId?: string; telefono?: string | null; usuarioId?: string | null }) {
  return (
    <CentroConversacion
      leadId={props.leadId ?? "lead-a"}
      usuarioId={props.usuarioId === undefined ? "usuario-1" : props.usuarioId}
      telefono={props.telefono === undefined ? TEL_A : props.telefono}
      hilo={hilo}
    />
  );
}

/** ¿Se reportó alguna vez un rect (o sea, la vista nativa se pidió visible)? */
function reportoRect(crm: ReturnType<typeof crmEscritorioFake>): boolean {
  return vi.mocked(crm.reportarAreaWhatsApp).mock.calls.some(([area]) => area !== null);
}

function botonModo(nombre: "WhatsApp Web" | "Hilo del CRM") {
  return screen.getByRole("button", { name: nombre });
}

describe("CentroConversacion: donde no hay app de escritorio o no hay chat de WhatsApp", () => {
  test("en el navegador es el hilo del CRM, sin selector, sin controles y sin avisos", async () => {
    render(centro({}));
    await act(async () => {});

    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Qué mostrar de la conversación" })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajustar recorte" })).toBeNull();
    expect(screen.queryByText(/app de escritorio/i)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("en la app de escritorio, un chat sin teléfono válido (Instagram, Messenger, sin número) es solo el hilo", async () => {
    const crm = conEscritorio();
    render(centro({ telefono: null }));
    await act(async () => {});

    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Qué mostrar de la conversación" })).toBeNull();
    expect(crm.abrirChat).not.toHaveBeenCalled();
    expect(reportoRect(crm)).toBe(false);
  });

  test("el render de servidor es siempre el hilo, aunque después se detecte la app de escritorio", () => {
    conEscritorio();
    const html = renderToString(centro({}));

    expect(html).toContain("hilo del CRM");
    expect(html).not.toContain("Hilo del CRM");
    expect(html).not.toContain("Cargando WhatsApp Web");
  });
});

describe("CentroConversacion: modo WhatsApp Web", () => {
  test("es el default: barra con el selector, hueco de WhatsApp y sin hilo", async () => {
    const crm = conEscritorio();
    render(centro({}));

    await waitFor(() => expect(reportoRect(crm)).toBe(true));
    expect(screen.queryByText("hilo del CRM")).toBeNull();
    expect(botonModo("WhatsApp Web").getAttribute("aria-pressed")).toBe("true");
    expect(botonModo("Hilo del CRM").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("switch", { name: "Ver WhatsApp completo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abrir WhatsApp Web" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ajustar recorte" })).toBeTruthy();
  });

  test("abre el chat una sola vez por lead, aun con StrictMode y re-renders", async () => {
    const crm = conEscritorio();
    const { rerender } = render(<StrictMode>{centro({})}</StrictMode>);
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledTimes(1));
    expect(crm.abrirChat).toHaveBeenCalledWith(TEL_A, "");

    // El refresco de 5 s del layout vuelve a renderizar con las mismas props.
    rerender(<StrictMode>{centro({})}</StrictMode>);
    await act(async () => {});
    expect(crm.abrirChat).toHaveBeenCalledTimes(1);
  });

  test("al cambiar de lead vuelve a abrir, con el número del nuevo", async () => {
    const crm = conEscritorio();
    const { rerender } = render(centro({}));
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledTimes(1));

    rerender(centro({ leadId: "lead-b", telefono: TEL_B }));
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledTimes(2));
    expect(crm.abrirChat).toHaveBeenLastCalledWith(TEL_B, "");
  });

  test("mientras abre muestra el estado de carga y si falla, el motivo en texto humano", async () => {
    let resolver: (r: { ok: false; motivo: string }) => void = () => {};
    const crm = conEscritorio({
      abrirChat: vi.fn().mockReturnValue(new Promise((res) => (resolver = res))),
    });
    render(centro({}));

    expect(await screen.findByText("Abriendo la conversación…")).toBeTruthy();

    await act(async () => resolver({ ok: false, motivo: "telefono_invalido" }));
    expect(
      await screen.findByText("El número de este lead no sirve para abrir un chat de WhatsApp."),
    ).toBeTruthy();
    expect(screen.queryByText("Abriendo la conversación…")).toBeNull();
    expect(crm.abrirChat).toHaveBeenCalledTimes(1);
  });

  test("si abrirChat se rechaza, muestra un error y no rompe la pantalla", async () => {
    conEscritorio({ abrirChat: vi.fn().mockRejectedValue(new Error("ipc")) });
    render(centro({}));
    expect(await screen.findByText("No se pudo abrir la conversación.")).toBeTruthy();
  });

  test("recargar con éxito vuelve a abrir el chat del lead", async () => {
    const crm = conEscritorio();
    render(centro({}));
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Abrir WhatsApp Web" }));
    await waitFor(() => expect(crm.mostrarWhatsApp).toHaveBeenCalledWith({ recargar: true }));
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledTimes(2));
    expect(crm.abrirChat).toHaveBeenLastCalledWith(TEL_A, "");
  });

  test("al salir del lead (desmontar) reporta null para que la vista nativa se oculte", async () => {
    const crm = conEscritorio();
    const { unmount } = render(centro({}));
    await waitFor(() => expect(reportoRect(crm)).toBe(true));

    unmount();
    expect(crm.reportarAreaWhatsApp).toHaveBeenLastCalledWith(null);
  });

  test("si el lead pasa a un chat que no es de WhatsApp, reporta null y vuelve el hilo", async () => {
    const crm = conEscritorio();
    const { rerender } = render(centro({}));
    await waitFor(() => expect(reportoRect(crm)).toBe(true));

    rerender(centro({ leadId: "lead-ig", telefono: null }));
    expect(vi.mocked(crm.reportarAreaWhatsApp).mock.calls.at(-1)?.[0]).toBeNull();
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Qué mostrar de la conversación" })).toBeNull();
  });
});

describe("CentroConversacion: selector y recuerdo por usuario", () => {
  test("Hilo del CRM muestra el hilo, oculta los controles de WhatsApp, reporta null y se recuerda", async () => {
    const crm = conEscritorio();
    render(centro({}));
    await waitFor(() => expect(reportoRect(crm)).toBe(true));

    fireEvent.click(botonModo("Hilo del CRM"));

    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(botonModo("Hilo del CRM").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir WhatsApp Web" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajustar recorte" })).toBeNull();
    expect(vi.mocked(crm.reportarAreaWhatsApp).mock.calls.at(-1)?.[0]).toBeNull();
    expect(window.localStorage.getItem(CLAVE_U1)).toBe("hilo");
  });

  test("la elección se recuerda entre visitas: con hilo guardado no abre WhatsApp ni reporta área", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    const crm = conEscritorio();
    render(centro({}));
    await act(async () => {});

    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(botonModo("Hilo del CRM").getAttribute("aria-pressed")).toBe("true");
    expect(crm.abrirChat).not.toHaveBeenCalled();
    expect(reportoRect(crm)).toBe(false);
  });

  test("es por usuario: lo que eligió uno no cambia el default de otro", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    conEscritorio();
    render(centro({ usuarioId: "usuario-2" }));
    await act(async () => {});

    expect(botonModo("WhatsApp Web").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("hilo del CRM")).toBeNull();
  });

  test("empezar en hilo y pasar a WhatsApp Web abre el chat de este lead, una sola vez", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    const crm = conEscritorio();
    render(centro({}));
    await act(async () => {});
    expect(crm.abrirChat).not.toHaveBeenCalled();

    fireEvent.click(botonModo("WhatsApp Web"));
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledTimes(1));
    expect(crm.abrirChat).toHaveBeenCalledWith(TEL_A, "");
    await waitFor(() => expect(reportoRect(crm)).toBe(true));

    fireEvent.click(botonModo("Hilo del CRM"));
    fireEvent.click(botonModo("WhatsApp Web"));
    await act(async () => {});
    expect(crm.abrirChat).toHaveBeenCalledTimes(1);
  });

  test("sin localStorage el selector igual funciona durante la sesión", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    conEscritorio();
    render(centro({ usuarioId: "usuario-sin-storage" }));
    await act(async () => {});
    expect(botonModo("WhatsApp Web").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(botonModo("Hilo del CRM"));
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(botonModo("Hilo del CRM").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("CentroConversacion: vista completa y recorte", () => {
  test("lee la vista al montar y muestra el valor del recorte en el panel de ajuste", async () => {
    conEscritorio({
      obtenerVistaWhatsApp: vi.fn().mockResolvedValue({ recorteIzquierdo: 300, completo: false }),
    });
    render(centro({}));

    const ajustar = await screen.findByRole("button", { name: "Ajustar recorte" });
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(ajustar.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(ajustar);
    expect(ajustar.getAttribute("aria-expanded")).toBe("true");
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.value).toBe("300");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("1200");
    expect(screen.getByText("300 px")).toBeTruthy();
    expect(
      screen.getByText(/Mové el corte hasta que desaparezca la lista de chats de WhatsApp\./),
    ).toBeTruthy();
  });

  test("el panel de ajuste abierto se va con el modo hilo", async () => {
    conEscritorio();
    render(centro({}));
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajustar recorte" }));
    expect(screen.getByRole("slider")).toBeTruthy();

    fireEvent.click(botonModo("Hilo del CRM"));
    expect(screen.queryByRole("slider")).toBeNull();
  });

  test("muestra si el recorte está guardado para este ancho o calculado de otros", async () => {
    conEscritorio({
      obtenerVistaWhatsApp: vi.fn().mockResolvedValue({
        recorteIzquierdo: 367,
        completo: false,
        anchoArea: 400,
        calibrado: false,
      }),
    });
    render(centro({}));
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajustar recorte" }));
    expect(
      screen.getByText(
        "Calculado a partir de otros anchos. Ajustalo si se ve la lista de WhatsApp.",
      ),
    ).toBeTruthy();

    // Mover el slider lo guarda como la calibración de este ancho.
    fireEvent.change(screen.getByRole("slider"), { target: { value: "380" } });
    expect(await screen.findByText("Guardado para este ancho de ventana (400 px).")).toBeTruthy();
    expect(screen.queryByText(/Calculado a partir de otros anchos/)).toBeNull();
  });

  test("con una app sin calibración por ancho no muestra ninguna de las dos leyendas", async () => {
    conEscritorio({
      obtenerVistaWhatsApp: vi.fn().mockResolvedValue({ recorteIzquierdo: 300, completo: false }),
    });
    render(centro({}));
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajustar recorte" }));
    expect(screen.queryByText(/Guardado para este ancho/)).toBeNull();
    expect(screen.queryByText(/Calculado a partir de otros anchos/)).toBeNull();
  });

  test("el slider sigue en vivo los cambios que avisa la app al cambiar el tamaño de la ventana", async () => {
    let avisar: ((estado: unknown) => void) | null = null;
    const desuscribir = vi.fn();
    const crm = conEscritorio({
      obtenerVistaWhatsApp: vi.fn().mockResolvedValue({
        recorteIzquierdo: 500,
        completo: false,
        anchoArea: 600,
        calibrado: true,
      }),
      alCambiarVistaWhatsApp: vi.fn().mockImplementation((cb: (estado: unknown) => void) => {
        avisar = cb;
        return desuscribir;
      }),
    });
    const { unmount } = render(centro({}));
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajustar recorte" }));
    expect(screen.getByText("Guardado para este ancho de ventana (600 px).")).toBeTruthy();

    act(() => {
      avisar?.({ recorteIzquierdo: 367, completo: false, anchoArea: 400, calibrado: false });
    });
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("367");
    expect(screen.getByText("367 px")).toBeTruthy();
    expect(screen.getByText(/Calculado a partir de otros anchos/)).toBeTruthy();
    expect(crm.configurarVistaWhatsApp).not.toHaveBeenCalled();

    expect(desuscribir).not.toHaveBeenCalled();
    unmount();
    expect(desuscribir).toHaveBeenCalledTimes(1);
  });

  test("con una app sin alCambiarVistaWhatsApp no se rompe", async () => {
    conEscritorio({ alCambiarVistaWhatsApp: undefined });
    render(centro({}));
    expect(await screen.findByRole("button", { name: "Ajustar recorte" })).toBeTruthy();
  });

  test("el slider manda el recorte en vivo a la app", async () => {
    const crm = conEscritorio();
    render(centro({}));
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajustar recorte" }));

    fireEvent.change(screen.getByRole("slider"), { target: { value: "450" } });
    expect(crm.configurarVistaWhatsApp).toHaveBeenCalledWith({ recorteIzquierdo: 450 });
    expect(await screen.findByText("450 px")).toBeTruthy();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "480" } });
    expect(crm.configurarVistaWhatsApp).toHaveBeenLastCalledWith({ recorteIzquierdo: 480 });
  });

  test("el interruptor manda completo, y con completo el slider queda deshabilitado", async () => {
    const crm = conEscritorio();
    render(centro({}));
    const interruptor = await screen.findByRole("switch", { name: "Ver WhatsApp completo" });
    await waitFor(() => expect((interruptor as HTMLButtonElement).disabled).toBe(false));
    expect(interruptor.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Ajustar recorte" }));

    fireEvent.click(interruptor);
    expect(crm.configurarVistaWhatsApp).toHaveBeenCalledWith({ completo: true });
    await waitFor(() => expect(interruptor.getAttribute("aria-checked")).toBe("true"));
    expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
  });

  test("si la app rechaza el cambio, muestra el motivo y vuelve al valor real", async () => {
    conEscritorio({
      obtenerVistaWhatsApp: vi.fn().mockResolvedValue({ recorteIzquierdo: 100, completo: false }),
      configurarVistaWhatsApp: vi.fn().mockResolvedValue({ ok: false, motivo: "recorte_invalido" }),
    });
    render(centro({}));
    await waitFor(() =>
      expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajustar recorte" }));

    fireEvent.change(screen.getByRole("slider"), { target: { value: "900" } });
    expect(await screen.findByText("El recorte tiene que estar entre 0 y 1200 px.")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("100"));
  });
});
