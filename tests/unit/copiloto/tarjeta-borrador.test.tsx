import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ContextoCopiloto,
  type ContextoCopilotoValor,
} from "@/components/inbox/copiloto/ContextoCopiloto";
import { TarjetaBorrador } from "@/components/inbox/copiloto/TarjetaBorrador";
import type { Canal } from "@/types/domain";
import type { BorradorVista } from "@/types/copiloto";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  toastError.mockClear();
  toastSuccess.mockClear();
});

const LEAD = "lead-1";
const SESION = "sesion-1";
const TEL = "593979932363";
const TEXTO = "Hola, sí tenemos ese filtro.";
const URL_ESPERADA = `https://web.whatsapp.com/send?phone=${TEL}&text=Hola%2C%20s%C3%AD%20tenemos%20ese%20filtro.`;

function contexto(parcial: Partial<ContextoCopilotoValor> = {}): ContextoCopilotoValor {
  return {
    ubicacion: "navegador",
    telefono: TEL,
    insertarEnWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
    ...parcial,
  };
}

function borrador(parcial: Partial<BorradorVista> = {}): BorradorVista {
  return {
    id: "b-1",
    estado: "listo",
    contenido: TEXTO,
    origen: "ia",
    reglaNombre: null,
    errorCodigo: null,
    usadoVia: null,
    creadoAt: "2026-09-30T15:00:00.000Z",
    ...parcial,
  };
}

function montar(ctx: ContextoCopilotoValor, b: BorradorVista = borrador(), canal: Canal = "wa") {
  const onUsar = vi.fn().mockResolvedValue({ ok: true });
  const onRegenerar = vi.fn().mockResolvedValue({ ok: true });
  const onEnviar = vi.fn().mockResolvedValue({ ok: true });
  const elemento = (bor: BorradorVista) => (
    <ContextoCopiloto.Provider value={ctx}>
      <TarjetaBorrador
        leadId={LEAD}
        sessionId={SESION}
        canal={canal}
        borrador={bor}
        onUsar={onUsar}
        onRegenerar={onRegenerar}
        onEnviar={onEnviar}
      />
    </ContextoCopiloto.Provider>
  );
  const utils = render(elemento(b));
  return {
    onUsar,
    onRegenerar,
    onEnviar,
    rerender: (bor: BorradorVista) => utils.rerender(elemento(bor)),
  };
}

const areaTexto = () =>
  screen.getByRole("textbox", { name: "Texto del borrador" }) as HTMLTextAreaElement;

describe("TarjetaBorrador — navegador", () => {
  it("la acción principal es un enlace a WhatsApp Web con el texto precargado; usarlo marca abrir_web", async () => {
    const { onUsar } = montar(contexto());

    const enlace = screen.getByRole("link", { name: /Abrir en WhatsApp Web/ });
    expect(enlace.getAttribute("href")).toBe(URL_ESPERADA);
    expect(enlace.getAttribute("target")).toBe("_blank");
    expect(enlace.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("button", { name: /Al composer/ })).toBeNull();

    fireEvent.click(enlace);
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "abrir_web",
        texto: TEXTO,
      }),
    );
  });

  it("el enlace usa el texto editado, no el original", () => {
    montar(contexto());
    fireEvent.change(areaTexto(), { target: { value: "Texto editado" } });
    expect(screen.getByRole("link", { name: /Abrir en WhatsApp Web/ }).getAttribute("href")).toBe(
      `https://web.whatsapp.com/send?phone=${TEL}&text=Texto%20editado`,
    );
  });

  it("Copiar escribe el texto editado en el portapapeles y marca copiar", async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: escribir },
      configurable: true,
    });
    const { onUsar } = montar(contexto());

    fireEvent.change(areaTexto(), { target: { value: "  Versión editada  " } });
    fireEvent.click(screen.getByRole("button", { name: /Copiar/ }));

    await waitFor(() => expect(escribir).toHaveBeenCalledWith("Versión editada"));
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "copiar",
        texto: "Versión editada",
      }),
    );
  });

  it("si el portapapeles falla lo dice y no marca usado", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denegado")) },
      configurable: true,
    });
    const { onUsar } = montar(contexto());

    fireEvent.click(screen.getByRole("button", { name: /Copiar/ }));

    await screen.findByText(/No se pudo copiar/);
    expect(onUsar).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter ejecuta la acción principal (abre el enlace)", async () => {
    const { onUsar } = montar(contexto());
    fireEvent.keyDown(areaTexto(), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith(expect.objectContaining({ via: "abrir_web" })),
    );
  });

  it("sin teléfono válido no hay enlace: queda Al composer, que envía por la API y luego marca al_composer", async () => {
    const { onUsar, onEnviar } = montar(contexto({ telefono: null }));

    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Al composer/ }));

    await waitFor(() =>
      expect(onEnviar).toHaveBeenCalledWith({
        leadId: LEAD,
        sessionId: SESION,
        canal: "wa",
        body: TEXTO,
      }),
    );
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "al_composer",
        texto: TEXTO,
      }),
    );
  });

  it("un teléfono que WhatsApp Web no abriría (7 dígitos) tampoco ofrece el enlace: queda Al composer", () => {
    montar(contexto({ telefono: "1234567" }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /Abrir en WhatsApp Web/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Al composer/ })).toBeTruthy();
  });

  it("tras enviar por Al composer la tarjeta pasa enseguida a 'Ya usado': no queda un segundo clic que reenvíe", async () => {
    const { onEnviar } = montar(contexto({ telefono: null }));

    fireEvent.click(screen.getByRole("button", { name: /Al composer/ }));

    await screen.findByText("Ya usado · enviado desde el CRM");
    expect(screen.queryByRole("button", { name: /Al composer/ })).toBeNull();
    expect(onEnviar).toHaveBeenCalledTimes(1);
  });

  it("si el envío por la API falla no marca usado", async () => {
    const { onUsar, onEnviar } = montar(contexto({ telefono: null }));
    onEnviar.mockResolvedValue({ ok: false, error: "Ventana cerrada" });

    fireEvent.click(screen.getByRole("button", { name: /Al composer/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Ventana cerrada"));
    expect(onUsar).not.toHaveBeenCalled();
  });

  it("si la action revienta en vez de devolver un error, no se cae nada: avisa y no marca usado", async () => {
    const { onUsar, onEnviar } = montar(contexto({ telefono: null }));
    onEnviar.mockRejectedValue(new Error("red caída"));

    fireEvent.click(screen.getByRole("button", { name: /Al composer/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onUsar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Al composer/ })).toBeTruthy();
  });
});

describe("TarjetaBorrador — app de escritorio", () => {
  it("en WhatsApp Web: Insertar pasa el texto al puente y luego marca insertar; no hay Al composer", async () => {
    const insertar = vi.fn().mockResolvedValue({ ok: true });
    const { onUsar } = montar(
      contexto({ ubicacion: "escritorio-whatsapp", insertarEnWhatsApp: insertar }),
    );

    expect(screen.queryByRole("button", { name: /Al composer/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    await waitFor(() => expect(insertar).toHaveBeenCalledWith(TEXTO));
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "insertar",
        texto: TEXTO,
      }),
    );
  });

  it("en Hilo del CRM hay Insertar y Al composer", () => {
    montar(contexto({ ubicacion: "escritorio-hilo" }));
    expect(screen.getByRole("button", { name: "Insertar en WhatsApp" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Al composer/ })).toBeTruthy();
  });

  it("si la app no puede insertar muestra el motivo, sugiere Copiar y NO marca usado", async () => {
    const insertar = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "WhatsApp Web tardó más de 30 segundos en cargar." });
    const { onUsar } = montar(
      contexto({ ubicacion: "escritorio-whatsapp", insertarEnWhatsApp: insertar }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("tardó más de 30 segundos");
    expect(alerta.textContent).toContain("Copiar");
    expect(onUsar).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter inserta el texto editado", async () => {
    const insertar = vi.fn().mockResolvedValue({ ok: true });
    montar(contexto({ ubicacion: "escritorio-whatsapp", insertarEnWhatsApp: insertar }));
    fireEvent.change(areaTexto(), { target: { value: "Editado a mano" } });
    fireEvent.keyDown(areaTexto(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(insertar).toHaveBeenCalledWith("Editado a mano"));
  });

  it("mientras la app abre el chat el botón principal lo dice y no se puede insertar dos veces", async () => {
    let resolver: (r: { ok: true }) => void = () => {};
    const insertar = vi.fn().mockReturnValue(new Promise((r) => (resolver = r)));
    montar(contexto({ ubicacion: "escritorio-whatsapp", insertarEnWhatsApp: insertar }));

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    const ocupado = await screen.findByRole("button", { name: /Insertando/ });
    expect((ocupado as HTMLButtonElement).disabled).toBe(true);
    expect(insertar).toHaveBeenCalledTimes(1);

    await act(async () => resolver({ ok: true }));
  });
});

describe("TarjetaBorrador — texto", () => {
  it("un borrador de más de 4096 caracteres se rechaza: ninguna acción de envío (ni Copiar) queda habilitada y se ve el contador", () => {
    montar(
      contexto({ ubicacion: "escritorio-whatsapp" }),
      borrador({ contenido: "a".repeat(4100) }),
    );

    expect(
      (screen.getByRole("button", { name: "Insertar en WhatsApp" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: /Copiar/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/4100\s*\/\s*4096/)).toBeTruthy();
    expect(areaTexto().getAttribute("aria-invalid")).toBe("true");
  });

  it("más de 4096 caracteres: Abrir en WhatsApp Web y Al composer tampoco se pueden usar", async () => {
    const { onUsar, onEnviar } = montar(
      contexto({ ubicacion: "navegador" }),
      borrador({ contenido: "a".repeat(4100) }),
    );
    expect(screen.queryByRole("link")).toBeNull();
    const abrir = screen.getByRole("button", {
      name: /Abrir en WhatsApp Web/,
    }) as HTMLButtonElement;
    expect(abrir.disabled).toBe(true);
    fireEvent.click(abrir);
    expect(onUsar).not.toHaveBeenCalled();

    cleanup();
    const otro = montar(
      contexto({ ubicacion: "escritorio-hilo" }),
      borrador({ contenido: "a".repeat(4100) }),
    );
    expect(
      (screen.getByRole("button", { name: /Al composer/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(otro.onEnviar).not.toHaveBeenCalled();
    expect(onEnviar).not.toHaveBeenCalled();
  });

  it("al recortar el texto por debajo de 4096 las acciones vuelven a habilitarse", () => {
    montar(
      contexto({ ubicacion: "escritorio-whatsapp" }),
      borrador({ contenido: "a".repeat(4100) }),
    );
    fireEvent.change(areaTexto(), { target: { value: "a".repeat(4096) } });
    expect(
      (screen.getByRole("button", { name: "Insertar en WhatsApp" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("lo editado sobrevive a un refresco con el mismo borrador (el poller de 5 s) y se resetea con otro", () => {
    const { rerender } = montar(contexto());
    fireEvent.change(areaTexto(), { target: { value: "Mi versión" } });

    rerender(borrador({ creadoAt: "2026-09-30T15:00:05.000Z" }));
    expect(areaTexto().value).toBe("Mi versión");

    rerender(borrador({ id: "b-2", contenido: "Borrador nuevo" }));
    expect(areaTexto().value).toBe("Borrador nuevo");
  });

  it("muestra el origen y la hora: «IA» o «Regla: <nombre>»", () => {
    const { rerender } = montar(contexto());
    expect(screen.getByRole("region", { name: "Borrador de la IA" }).textContent).toContain("IA");

    rerender(borrador({ origen: "regla", reglaNombre: "Abrimos de 9 a 18" }));
    expect(screen.getByRole("region", { name: "Borrador de la IA" }).textContent).toContain(
      "Regla: Abrimos de 9 a 18",
    );
  });
});

describe("TarjetaBorrador — estados", () => {
  it("redactando: estado anunciado y sin acciones", () => {
    montar(contexto(), borrador({ estado: "redactando", contenido: null, origen: null }));
    expect(screen.getByRole("status").textContent).toContain("Redactando…");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("usado: atenuado, de solo lectura, dice cómo se usó y no ofrece enviar de nuevo", () => {
    montar(contexto(), borrador({ estado: "usado", usadoVia: "copiar" }));
    expect(screen.getByText("Ya usado · copiado")).toBeTruthy();
    expect(areaTexto().readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("error: alerta con la frase del código y Reintentar", async () => {
    const { onRegenerar } = montar(
      contexto(),
      borrador({ estado: "error", contenido: null, origen: null, errorCodigo: "tope_diario" }),
    );

    expect(screen.getByRole("alert").textContent).toContain("tope de gasto diario");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(onRegenerar).toHaveBeenCalledWith({ leadId: LEAD, borradorId: "b-1" }),
    );
  });

  it("Regenerar pide la regeneración y pasa a 'Redactando…' enseguida, sin esperar al refresco", async () => {
    const { onRegenerar } = montar(contexto());

    fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));

    await waitFor(() =>
      expect(onRegenerar).toHaveBeenCalledWith({ leadId: LEAD, borradorId: "b-1" }),
    );
    expect((await screen.findByRole("status")).textContent).toContain("Redactando…");
  });

  it("si Regenerar falla avisa y deja el borrador como estaba", async () => {
    const { onRegenerar } = montar(contexto());
    onRegenerar.mockResolvedValue({ ok: false, error: "Ese borrador ya no se puede regenerar." });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));
    });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Ese borrador ya no se puede regenerar."),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(areaTexto().value).toBe(TEXTO);
  });

  it("si Regenerar falla, lo que la persona había editado sigue ahí (el texto no vive en lo que se desmonta)", async () => {
    const { onRegenerar } = montar(contexto());
    onRegenerar.mockResolvedValue({ ok: false, error: "No se pudo regenerar." });
    fireEvent.change(areaTexto(), { target: { value: "Mi versión a medio escribir" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));
    });

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No se pudo regenerar."));
    expect(areaTexto().value).toBe("Mi versión a medio escribir");
  });

  it("si la action de Regenerar revienta tampoco se pierde el texto ni queda 'Redactando…'", async () => {
    const { onRegenerar } = montar(contexto());
    onRegenerar.mockRejectedValue(new Error("red caída"));
    fireEvent.change(areaTexto(), { target: { value: "Mi versión" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));
    });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(areaTexto().value).toBe("Mi versión");
  });

  it("si la regeneración se omite (la action devolvió ok pero no llega un borrador nuevo) deja de decir 'Redactando…' y lo explica", async () => {
    vi.useFakeTimers();
    montar(contexto());
    fireEvent.change(areaTexto(), { target: { value: "Mi versión" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));
    });
    expect(screen.getByRole("status").textContent).toContain("Redactando…");

    await act(async () => {
      vi.advanceTimersByTime(46_000);
    });

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("No se pudo regenerar");
    expect(areaTexto().value).toBe("Mi versión");
    expect(screen.getByRole("button", { name: /Regenerar/ })).toBeTruthy();
  });

  it("si en el estado de error Reintentar no produce un borrador nuevo, el aviso de omitido convive con el error", async () => {
    vi.useFakeTimers();
    montar(
      contexto(),
      borrador({ estado: "error", contenido: null, origen: null, errorCodigo: "llm_error" }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    });
    expect(screen.getByRole("status").textContent).toContain("Redactando…");
    await act(async () => {
      vi.advanceTimersByTime(46_000);
    });

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/No se pudo regenerar/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("si llega el borrador nuevo antes del plazo, se muestra el nuevo y no hay aviso", async () => {
    const { rerender } = montar(contexto());
    fireEvent.change(areaTexto(), { target: { value: "Mi versión" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));
    });

    rerender(borrador({ id: "b-2", contenido: "Otra respuesta" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(areaTexto().value).toBe("Otra respuesta");
  });
});

describe("TarjetaBorrador — canales", () => {
  it("el copiloto es solo de WhatsApp: en Instagram y Messenger no hay tarjeta", () => {
    montar(contexto(), borrador(), "ig");
    expect(screen.queryByRole("region", { name: "Borrador de la IA" })).toBeNull();
    cleanup();
    montar(contexto(), borrador(), "fb");
    expect(screen.queryByRole("region", { name: "Borrador de la IA" })).toBeNull();
  });
});
