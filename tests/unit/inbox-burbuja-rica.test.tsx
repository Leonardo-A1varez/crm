import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Mensaje, MensajeMetadata } from "@/types/entities";
import type { TipoMensaje } from "@/types/domain";

/**
 * Lo que manda un flujo con botones, lista, imagen o ubicación aparece en el
 * hilo con su forma, no como una línea de sistema ni como texto plano.
 */

function mensaje(
  tipo: TipoMensaje,
  metadata: MensajeMetadata,
  extra: Partial<Mensaje> = {},
): Mensaje {
  return {
    id: "m1",
    conversacion_id: "c1",
    lead_session_id: "s1",
    direction: "out",
    sender: "sistema",
    sender_user_id: null,
    tipo,
    contenido: null,
    media_url: null,
    meta_message_id: "wamid.1",
    idempotency_key: "wf:r:1",
    metadata,
    created_at: new Date("2026-09-26T15:00:00Z"),
    estado_entrega: "entregado",
    estado_entrega_at: null,
    error_entrega: null,
    ...extra,
  };
}

afterEach(cleanup);

describe("MessageBubble — mensajes ricos de un flujo", () => {
  it("botones: el texto y cada botón, marcado como enviado por un flujo", () => {
    render(
      <MessageBubble
        message={mensaje(
          "interactive",
          {
            rico: {
              tipo: "botones",
              cuerpo: "¿Te lo reservo?",
              botones: [
                { id: "si", titulo: "Sí" },
                { id: "no", titulo: "No" },
              ],
            },
          },
          { contenido: "¿Te lo reservo?" },
        )}
      />,
    );
    expect(screen.getByText("¿Te lo reservo?")).toBeTruthy();
    const lista = screen.getByRole("list", { name: /botones/i });
    expect(
      within(lista)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Sí", "No"]);
    expect(screen.getByText(/flujo/i)).toBeTruthy();
  });

  it("lista: el botón que la abre y sus opciones", () => {
    render(
      <MessageBubble
        message={mensaje(
          "interactive",
          {
            rico: {
              tipo: "lista",
              encabezado: "Repuestos",
              cuerpo: "¿Qué buscás?",
              pie: null,
              boton: "Ver opciones",
              secciones: [
                {
                  titulo: "Motor",
                  filas: [{ id: "f", titulo: "Filtro", descripcion: "De aceite" }],
                },
              ],
            },
          },
          { contenido: "¿Qué buscás?" },
        )}
      />,
    );
    expect(screen.getByText("Ver opciones")).toBeTruthy();
    expect(screen.getByText("Filtro")).toBeTruthy();
    expect(screen.getByText("De aceite")).toBeTruthy();
  });

  it("ubicación: nombre, dirección y enlace al mapa con las coordenadas", () => {
    render(
      <MessageBubble
        message={mensaje(
          "location",
          {
            rico: {
              tipo: "ubicacion",
              lat: -2.17,
              lon: -79.92,
              nombre: "Local",
              direccion: "Av. 1",
            },
          },
          { contenido: "Local · Av. 1" },
        )}
      />,
    );
    const enlace = screen.getByRole("link", { name: /mapa/i });
    expect(enlace.getAttribute("href")).toBe(
      "https://www.openstreetmap.org/?mlat=-2.17&mlon=-79.92#map=17/-2.17/-79.92",
    );
    expect(screen.getByText("Local")).toBeTruthy();
  });

  it("imagen subida: dice que es una imagen y muestra el pie", () => {
    render(
      <MessageBubble
        message={mensaje(
          "image",
          { rico: { tipo: "imagen", url: null, archivo: "flujos/a.jpg", caption: "Mirá" } },
          { contenido: "Mirá" },
        )}
      />,
    );
    expect(screen.getByText(/imagen/i)).toBeTruthy();
    expect(screen.getByText("Mirá")).toBeTruthy();
  });

  it("un texto de sistema sin forma rica sigue siendo una línea de sistema", () => {
    render(<MessageBubble message={mensaje("text", {}, { contenido: "Te diste de baja" })} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/Te diste de baja/)).toBeTruthy();
  });
});
