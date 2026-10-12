import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const subidas: Array<{ ruta: string; token: string; tipo: string | undefined }> = [];
vi.mock("@/lib/realtime/cliente-navegador", () => ({
  clienteNavegador: () => ({
    storage: {
      from: () => ({
        uploadToSignedUrl: async (
          ruta: string,
          token: string,
          _f: File,
          o?: { contentType?: string },
        ) => {
          subidas.push({ ruta, token, tipo: o?.contentType });
          return { error: null };
        },
      }),
    },
  }),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

import { MessageInput } from "@/components/inbox/MessageInput";
import { estadoVentana } from "@/lib/ventana";

const LEAD = "7d9e8a10-0bd4-4b8a-8b43-5c2e1f0a9b77";
const SESION = "0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1";
const ventana = estadoVentana(new Date(), new Date());
const ultimo = new Date().toISOString();

function montar(over: Partial<Parameters<typeof MessageInput>[0]> = {}) {
  const preparar = vi.fn(async () => ({
    ok: true as const,
    ruta: "sesiones/s/o.pdf",
    token: "tok",
  }));
  const enviar = vi.fn(async () => ({ ok: true as const }));
  const onSend = vi.fn(async () => ({ ok: true as const }));
  render(
    <MessageInput
      leadId={LEAD}
      sessionId={SESION}
      canal="wa"
      ventana={ventana}
      ultimoEntranteIso={ultimo}
      onSend={onSend}
      onPrepararAdjunto={preparar}
      onEnviarAdjunto={enviar}
      {...over}
    />,
  );
  return { preparar, enviar, onSend };
}

function elegir(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  subidas.length = 0;
  toastError.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:vista-previa");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("composer: adjuntar archivos", () => {
  it("el boton de adjuntar solo existe en WhatsApp y con las acciones conectadas", () => {
    montar();
    expect(screen.getByRole("button", { name: /adjuntar archivo/i })).toBeTruthy();
    cleanup();
    montar({ canal: "ig" });
    expect(screen.queryByRole("button", { name: /adjuntar archivo/i })).toBeNull();
    cleanup();
    montar({ onPrepararAdjunto: undefined, onEnviarAdjunto: undefined });
    expect(screen.queryByRole("button", { name: /adjuntar archivo/i })).toBeNull();
  });

  it("el input solo ofrece lo que Meta acepta", () => {
    montar();
    const accept = (document.querySelector('input[type="file"]') as HTMLInputElement).accept;
    expect(accept).toContain("application/pdf");
    expect(accept).toContain("image/jpeg");
    expect(accept).not.toContain("image/gif");
  });

  it("un archivo que Meta no acepta se rechaza con el motivo y no queda elegido", () => {
    montar();
    elegir(new File(["x"], "virus.exe", { type: "application/x-msdownload" }));
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/no acepta ese tipo/));
    expect(screen.queryByRole("group", { name: /archivo para enviar/i })).toBeNull();
  });

  it("un video de mas de 16 MB se rechaza antes de subir nada", () => {
    const { preparar } = montar();
    const grande = new File([new Uint8Array(1)], "v.mp4", { type: "video/mp4" });
    Object.defineProperty(grande, "size", { value: 17 * 1024 * 1024 });
    elegir(grande);
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/16 MB/));
    expect(preparar).not.toHaveBeenCalled();
  });

  it("elegir un PDF muestra nombre y tamano, y se puede quitar", () => {
    montar();
    elegir(new File([new Uint8Array(1536)], "Lista.pdf", { type: "application/pdf" }));
    const grupo = screen.getByRole("group", { name: /archivo para enviar/i });
    expect(grupo.textContent).toContain("Lista.pdf");
    expect(grupo.textContent).toContain("1,5 KB");
    fireEvent.click(screen.getByRole("button", { name: /quitar archivo/i }));
    expect(screen.queryByRole("group", { name: /archivo para enviar/i })).toBeNull();
  });

  it("enviar: prepara, sube directo a Storage con el token y manda con el texto escrito", async () => {
    const { preparar, enviar, onSend } = montar();
    elegir(new File([new Uint8Array(10)], "Lista.pdf", { type: "application/pdf" }));
    fireEvent.change(screen.getByLabelText("Texto del archivo"), {
      target: { value: " la lista " },
    });
    fireEvent.click(screen.getByRole("button", { name: /enviar archivo/i }));

    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(preparar).toHaveBeenCalledWith({
      leadId: LEAD,
      sessionId: SESION,
      canal: "wa",
      nombre: "Lista.pdf",
      mime: "application/pdf",
      bytes: 10,
    });
    expect(subidas).toEqual([{ ruta: "sesiones/s/o.pdf", token: "tok", tipo: "application/pdf" }]);
    expect(enviar).toHaveBeenCalledWith({
      leadId: LEAD,
      sessionId: SESION,
      canal: "wa",
      ruta: "sesiones/s/o.pdf",
      nombre: "Lista.pdf",
      caption: "la lista",
    });
    // No se mando ademas un texto suelto.
    expect(onSend).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: /archivo para enviar/i })).toBeNull(),
    );
  });

  it("si el servidor rechaza, avisa con su mensaje y el archivo sigue elegido para reintentar", async () => {
    const { preparar } = montar();
    preparar.mockResolvedValueOnce({
      ok: false,
      error: "La ventana de 24 h está cerrada",
    } as never);
    elegir(new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" }));
    fireEvent.click(screen.getByRole("button", { name: /enviar archivo/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("La ventana de 24 h está cerrada"));
    expect(screen.getByRole("group", { name: /archivo para enviar/i })).toBeTruthy();
  });

  it("un audio no lleva texto: la caja se bloquea y lo explica", () => {
    montar();
    elegir(new File([new Uint8Array(10)], "nota.ogg", { type: "audio/ogg" }));
    const caja = screen.getByLabelText("Texto del archivo") as HTMLTextAreaElement;
    expect(caja.disabled).toBe(true);
    expect(caja.placeholder).toMatch(/audio va sin texto/i);
  });

  it("sin archivo, enviar sigue siendo el texto de siempre", async () => {
    const { onSend, preparar } = montar();
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(preparar).not.toHaveBeenCalled();
  });
});
