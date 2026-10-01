import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Mensaje } from "@/types/entities";

afterEach(cleanup);

function saliente(parcial: Partial<Mensaje> = {}): Mensaje {
  return {
    id: "m1",
    conversacion_id: "c1",
    lead_session_id: "s1",
    direction: "out",
    sender: "humano",
    sender_user_id: "u1",
    tipo: "text",
    contenido: "Hola, sí tenemos ese filtro.",
    media_url: null,
    meta_message_id: null,
    idempotency_key: "copiloto:b-1",
    metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: "b-1" },
    created_at: new Date("2026-09-30T15:00:00Z"),
    estado_entrega: null,
    estado_entrega_at: null,
    error_entrega: null,
    ...parcial,
  };
}

describe("MessageBubble - enviado por WhatsApp Web, sin confirmar", () => {
  it("dice que se envió por WhatsApp Web sin confirmar y no pinta el reloj de sin acuse", () => {
    render(<MessageBubble message={saliente()} />);
    expect(screen.getByText("Enviado por WhatsApp Web, sin confirmar")).toBeTruthy();
    expect(screen.queryByLabelText("Sin acuse todavia")).toBeNull();
    expect(screen.getByText("Hola, sí tenemos ese filtro.")).toBeTruthy();
  });

  it("un entrante nunca muestra la marca, aunque su metadata la traiga", () => {
    render(<MessageBubble message={saliente({ direction: "in", sender: "lead" })} />);
    expect(screen.queryByText(/sin confirmar/)).toBeNull();
  });

  it("un saliente humano normal sigue mostrando su acuse", () => {
    render(
      <MessageBubble
        message={saliente({
          metadata: {},
          idempotency_key: null,
          meta_message_id: "wamid.1",
          estado_entrega: "entregado",
        })}
      />,
    );
    expect(screen.queryByText(/sin confirmar/)).toBeNull();
    expect(screen.getByLabelText("Entregado")).toBeTruthy();
  });
});
