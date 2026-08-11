import { describe, expect, test } from "vitest";
import { calcularSinResponder } from "@/lib/sin-responder";
import type { Mensaje } from "@/types/entities";
import type { Direction, Sender } from "@/types/domain";

let n = 0;
function msg(direction: Direction, sender: Sender, minuto: number): Mensaje {
  n += 1;
  return {
    id: `m-${n}`,
    conversacion_id: "conv-1",
    lead_session_id: "session-1",
    direction,
    sender,
    sender_user_id: null,
    tipo: "text",
    contenido: "texto",
    media_url: null,
    meta_message_id: null,
    idempotency_key: null,
    metadata: {},
    created_at: new Date(2026, 2, 10, 12, minuto, 0),
    estado_entrega: null,
    estado_entrega_at: null,
    error_entrega: null,
  };
}

describe("calcularSinResponder", () => {
  test("hilo vacío no espera nada", () => {
    expect(calcularSinResponder([])).toEqual({ sinResponder: 0, esperandoDesde: null });
  });

  test("cuenta los entrantes posteriores a nuestra última salida", () => {
    const r = calcularSinResponder([
      msg("in", "lead", 0),
      msg("out", "ia", 1),
      msg("in", "lead", 2),
      msg("in", "lead", 3),
    ]);
    expect(r.sinResponder).toBe(2);
    // Espera desde el PRIMERO de los pendientes, no desde el último.
    expect(r.esperandoDesde).toEqual(new Date(2026, 2, 10, 12, 2, 0));
  });

  test("una respuesta al final deja el hilo en cero", () => {
    const r = calcularSinResponder([msg("in", "lead", 0), msg("out", "humano", 1)]);
    expect(r).toEqual({ sinResponder: 0, esperandoDesde: null });
  });

  test("un saliente de sistema no cuenta como haber contestado", () => {
    const r = calcularSinResponder([
      msg("out", "ia", 0),
      msg("in", "lead", 1),
      msg("out", "sistema", 2),
    ]);
    expect(r.sinResponder).toBe(1);
    expect(r.esperandoDesde).toEqual(new Date(2026, 2, 10, 12, 1, 0));
  });
});
