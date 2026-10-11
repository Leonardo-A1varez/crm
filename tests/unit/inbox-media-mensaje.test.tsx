import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { bytesLegibles } from "@/lib/media/formato";
import type { Mensaje, MensajeMedia } from "@/types/entities";
import type { TipoMensaje } from "@/types/domain";

/**
 * El hilo del Inbox muestra el archivo de los mensajes de WhatsApp: miniatura
 * ampliable, reproductores, tarjeta de documento, y estados de carga y error. Lo
 * que dibuja viene de columnas y de un nombre ajeno: nunca HTML.
 */

const ID = "7d9e8a10-0bd4-4b8a-8b43-5c2e1f0a9b77";

function media(over: Partial<MensajeMedia> = {}): MensajeMedia {
  return {
    estado: "descargado",
    metaId: "M",
    path: `sesiones/0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1/${ID}.webp`,
    mime: "image/webp",
    bytes: 2048,
    nombre: null,
    error: null,
    descargadoAt: new Date(),
    ...over,
  };
}

function mensaje(tipo: TipoMensaje, m: MensajeMedia | null, extra: Partial<Mensaje> = {}): Mensaje {
  return {
    id: ID,
    conversacion_id: "c1",
    lead_session_id: "s1",
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo,
    contenido: null,
    media_url: null,
    media: m,
    meta_message_id: "wamid.1",
    idempotency_key: null,
    metadata: {},
    created_at: new Date("2026-10-12T15:00:00Z"),
    estado_entrega: null,
    estado_entrega_at: null,
    error_entrega: null,
    ...extra,
  };
}

afterEach(cleanup);

describe("MessageBubble: archivos", () => {
  it("imagen: miniatura que apunta a /api/media (nunca a una URL del bucket) y abre en un dialogo accesible", () => {
    render(<MessageBubble message={mensaje("image", media())} />);
    const img = screen.getByRole("img", { name: /imagen/i });
    expect(img.getAttribute("src")).toBe(`/api/media/${ID}`);
    expect(img.getAttribute("loading")).toBe("lazy");

    const abrir = screen.getByRole("button", { name: /ampliar imagen/i });
    fireEvent.click(abrir);
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toBeTruthy();
    // El dialogo tiene nombre y su propia imagen grande + descarga.
    expect(
      dialogo.getAttribute("aria-labelledby") || dialogo.getAttribute("aria-label"),
    ).toBeTruthy();
    const grande = dialogo.querySelector("img");
    expect(grande?.getAttribute("src")).toBe(`/api/media/${ID}`);
    expect(dialogo.querySelector(`a[href="/api/media/${ID}?descargar=1"]`)).not.toBeNull();
  });

  it("con caption se ve el texto debajo", () => {
    render(<MessageBubble message={mensaje("image", media(), { contenido: "esta pieza" })} />);
    expect(screen.getByText("esta pieza")).toBeTruthy();
  });

  it("sticker: se ve como imagen chica y descriptiva", () => {
    render(<MessageBubble message={mensaje("image", media(), { metadata: { sticker: true } })} />);
    expect(screen.getByRole("img", { name: /sticker/i })).toBeTruthy();
  });

  it("audio: reproductor nativo con etiqueta; nota de voz lo dice", () => {
    const { container } = render(
      <MessageBubble
        message={mensaje("audio", media({ mime: "audio/ogg" }), { metadata: { voz: true } })}
      />,
    );
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe(`/api/media/${ID}`);
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(audio?.getAttribute("preload")).toBe("none");
    expect(audio?.getAttribute("aria-label")).toMatch(/nota de voz/i);
  });

  it("video: reproductor con controles", () => {
    const { container } = render(
      <MessageBubble message={mensaje("video", media({ mime: "video/mp4" }))} />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(`/api/media/${ID}`);
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
  });

  it("documento: tarjeta con nombre, tamano y enlace de descarga (nunca en linea)", () => {
    render(
      <MessageBubble
        message={mensaje(
          "doc",
          media({ mime: "application/pdf", nombre: "Lista Corolla.pdf", bytes: 1536 }),
        )}
      />,
    );
    expect(screen.getByText("Lista Corolla.pdf")).toBeTruthy();
    expect(screen.getByText("1,5 KB")).toBeTruthy();
    const enlace = screen.getByRole("link", { name: /descargar/i });
    expect(enlace.getAttribute("href")).toBe(`/api/media/${ID}?descargar=1`);
  });

  it("un nombre con HTML se muestra como texto, no se interpreta", () => {
    const { container } = render(
      <MessageBubble
        message={mensaje(
          "doc",
          media({ mime: "application/pdf", nombre: '<img src=x onerror="alert(1)">.pdf' }),
        )}
      />,
    );
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">.pdf')).toBeTruthy();
  });

  it("binario sin tipo reconocido: tarjeta de descarga, jamas un <img> o <iframe>", () => {
    const { container } = render(
      <MessageBubble
        message={mensaje("image", media({ mime: "application/octet-stream", nombre: null }))}
      />,
    );
    expect(container.querySelector("img, iframe, object, embed")).toBeNull();
    expect(screen.getByRole("link", { name: /descargar/i })).toBeTruthy();
  });

  it("pendiente: aviso de descarga con role status", () => {
    render(
      <MessageBubble message={mensaje("image", media({ estado: "pendiente", path: null }))} />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/descargando/i);
  });

  it("fallido y omitido dicen por que, sin inventar", () => {
    const { rerender } = render(
      <MessageBubble
        message={mensaje(
          "image",
          media({ estado: "fallido", path: null, error: "media_no_disponible" }),
        )}
      />,
    );
    expect(screen.getByText(/ya no está disponible/i)).toBeTruthy();
    rerender(
      <MessageBubble
        message={mensaje(
          "doc",
          media({ estado: "omitido", path: null, error: "demasiado_grande" }),
        )}
      />,
    );
    expect(screen.getByText(/50 MB/)).toBeTruthy();
    rerender(
      <MessageBubble
        message={mensaje(
          "image",
          media({ estado: "omitido", path: null, error: "historial_viejo" }),
        )}
      />,
    );
    expect(screen.getByText(/14 días/)).toBeTruthy();
  });

  it("si la imagen no carga, avisa y ofrece reintentar", () => {
    render(<MessageBubble message={mensaje("image", media())} />);
    fireEvent.error(screen.getByRole("img", { name: /imagen/i }));
    expect(screen.getByText(/no se pudo cargar/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    const otra = screen.getByRole("img", { name: /imagen/i });
    expect(otra.getAttribute("src")).toMatch(new RegExp(`^/api/media/${ID}\\?r=1$`));
  });

  it("un mensaje viejo sin columnas de media conserva la etiqueta de siempre", () => {
    render(<MessageBubble message={mensaje("image", null)} />);
    expect(screen.getByText(/\[Imagen\]/)).toBeTruthy();
  });
});

describe("bytesLegibles", () => {
  it("usa coma decimal y la unidad que corresponde", () => {
    expect(bytesLegibles(0)).toBe("0 B");
    expect(bytesLegibles(900)).toBe("900 B");
    expect(bytesLegibles(1536)).toBe("1,5 KB");
    expect(bytesLegibles(5 * 1024 * 1024)).toBe("5 MB");
    expect(bytesLegibles(1.25 * 1024 * 1024)).toBe("1,3 MB");
    expect(bytesLegibles(null)).toBe("");
  });
});
