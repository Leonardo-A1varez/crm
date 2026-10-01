import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CentroConversacion } from "@/components/inbox/CentroConversacion";
import { TarjetaBorrador } from "@/components/inbox/copiloto/TarjetaBorrador";
import type { BorradorVista } from "@/types/copiloto";
import { crmEscritorioFake, ResizeObserverMock } from "../../helpers/crm-escritorio-fake";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const TEL = "593979932363";
const TEXTO = "Hola, sí tenemos ese filtro.";
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

const borrador: BorradorVista = {
  id: "b-1",
  estado: "listo",
  contenido: TEXTO,
  origen: "ia",
  reglaNombre: null,
  errorCodigo: null,
  usadoVia: null,
  creadoAt: "2026-09-30T15:00:00.000Z",
};

function montar(telefono: string | null = TEL) {
  const onUsar = vi.fn().mockResolvedValue({ ok: true });
  const onEnviar = vi.fn().mockResolvedValue({ ok: true });
  const tarjeta = (
    <TarjetaBorrador
      leadId="lead-a"
      sessionId="s-1"
      canal="wa"
      borrador={borrador}
      onUsar={onUsar}
      onRegenerar={vi.fn().mockResolvedValue({ ok: true })}
      onEnviar={onEnviar}
    />
  );
  // Igual que la página: la misma tarjeta va dentro del hilo (sobre el composer) y
  // como prop del centro (entre la barra y la vista de WhatsApp).
  render(
    <CentroConversacion
      leadId="lead-a"
      usuarioId="usuario-1"
      telefono={telefono}
      tarjeta={tarjeta}
      hilo={
        <>
          <p>hilo del CRM</p>
          {tarjeta}
        </>
      }
    />,
  );
  return { onUsar, onEnviar };
}

describe("CentroConversacion con la tarjeta del copiloto", () => {
  it("en WhatsApp Web la tarjeta va entre la barra y la vista, y Insertar precarga el texto con el puente", async () => {
    const crm = conEscritorio();
    const { onUsar } = montar();
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledWith(TEL, ""));

    const barra = screen.getByRole("group", { name: "Qué mostrar de la conversación" });
    const tarjeta = screen.getByRole("region", { name: "Borrador de la IA" });
    expect(barra.compareDocumentPosition(tarjeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("hilo del CRM")).toBeNull();
    expect(screen.queryByRole("button", { name: /Al composer/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    await waitFor(() => expect(crm.abrirChat).toHaveBeenLastCalledWith(TEL, TEXTO));
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith(
        expect.objectContaining({ via: "insertar", texto: TEXTO }),
      ),
    );
  });

  it("Insertar manda al puente el texto editado, no el del borrador", async () => {
    const crm = conEscritorio();
    montar();
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledWith(TEL, ""));

    fireEvent.change(screen.getByRole("textbox", { name: "Texto del borrador" }), {
      target: { value: "Sí, tenemos. ¿Para qué año?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    await waitFor(() =>
      expect(crm.abrirChat).toHaveBeenLastCalledWith(TEL, "Sí, tenemos. ¿Para qué año?"),
    );
  });

  it("en Hilo del CRM Insertar abre el chat con el texto y pasa a WhatsApp Web sin recargarlo vacío", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    const crm = conEscritorio();
    montar();
    await act(async () => {});
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(crm.abrirChat).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Al composer/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "WhatsApp Web" }).getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    // Una sola llamada, con el texto: el efecto de "abrir al entrar" no pisa lo precargado con "".
    expect(crm.abrirChat).toHaveBeenCalledTimes(1);
    expect(crm.abrirChat).toHaveBeenCalledWith(TEL, TEXTO);
  });

  it("si la app rechaza el pedido lo muestra en texto humano y no marca usado ni cambia de vista", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    const crm = conEscritorio({
      abrirChat: vi.fn().mockResolvedValue({ ok: false, motivo: "timeout_30s" }),
    });
    const { onUsar } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("más de 30 segundos");
    expect(onUsar).not.toHaveBeenCalled();
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(crm.abrirChat).toHaveBeenCalledTimes(1);
  });

  it("si el puente revienta (promesa rechazada) también lo muestra y no marca usado", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    conEscritorio({ abrirChat: vi.fn().mockRejectedValue(new Error("ipc roto")) });
    const { onUsar } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("No se pudo abrir la conversación");
    expect(onUsar).not.toHaveBeenCalled();
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
  });

  it("tras un Insertar fallido desde el hilo, entrar a WhatsApp Web a mano sí abre el chat", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    const abrirChat = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, motivo: "timeout_30s" })
      .mockResolvedValue({ ok: true, ms: 5, mostrada: true });
    conEscritorio({ abrirChat });
    montar();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp Web" }));

    await waitFor(() => expect(abrirChat).toHaveBeenCalledTimes(2));
    expect(abrirChat).toHaveBeenLastCalledWith(TEL, "");
  });

  it("en el navegador (sin app de escritorio) la acción principal es el enlace a WhatsApp Web", async () => {
    montar();
    await act(async () => {});
    expect(screen.getByRole("link", { name: /Abrir en WhatsApp Web/ })).toBeTruthy();
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
  });

  it("en la app de escritorio con un lead sin teléfono válido: hilo y Al composer, sin Insertar", async () => {
    conEscritorio();
    montar(null);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Insertar en WhatsApp" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: /Al composer/ })).toBeTruthy();
  });
});
