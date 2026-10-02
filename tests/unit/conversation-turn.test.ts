import { afterEach, describe, expect, test, vi } from "vitest";
import type { LeadVehiculo } from "@/types/entities";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import {
  buildConversationTurn,
  buildRespondInput,
  vehiculosParaAgente,
} from "@/server/services/agente/conversation-turn";

const CLASIFICACION = { intent_nombre: "horario", confidence: 0.8 };

afterEach(() => {
  vi.useRealTimers();
});

describe("buildRespondInput", () => {
  test("arma el input de respond con los campos del turno", () => {
    expect(
      buildRespondInput({
        leadSessionId: "s-1",
        conversationTurn: ["lead: hola"],
        classification: CLASIFICACION,
        mensajeOrigenId: "m-1",
        tramos: [],
      }),
    ).toEqual({
      leadSessionId: "s-1",
      conversationTurn: ["lead: hola"],
      classification: CLASIFICACION,
      mensajeOrigenId: "m-1",
    });
  });

  test("las instrucciones de los tramos delegados viajan como instruccionesTramo", () => {
    const input = buildRespondInput({
      leadSessionId: "s-1",
      conversationTurn: [],
      classification: CLASIFICACION,
      mensajeOrigenId: "m-1",
      tramos: [
        { instrucciones: "Pedí la patente" },
        { instrucciones: null },
        { instrucciones: "Sé breve" },
      ],
    });
    expect(input.instruccionesTramo).toEqual(["Pedí la patente", "Sé breve"]);
  });

  test("soloRedactar viaja solo cuando se pide", () => {
    const base = {
      leadSessionId: "s-1",
      conversationTurn: [],
      classification: CLASIFICACION,
      mensajeOrigenId: "m-1",
      tramos: [],
    };
    expect(buildRespondInput({ ...base, soloRedactar: true }).soloRedactar).toBe(true);
    expect("soloRedactar" in buildRespondInput(base)).toBe(false);
  });

  test("tramos sin instrucciones no agregan la clave", () => {
    const input = buildRespondInput({
      leadSessionId: "s-1",
      conversationTurn: [],
      classification: CLASIFICACION,
      mensajeOrigenId: "m-1",
      tramos: [{ instrucciones: null }],
    });
    expect("instruccionesTramo" in input).toBe(false);
  });
});

describe("buildConversationTurn", () => {
  test("del más viejo al más nuevo y con el resumen previo al principio", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const messages = new InMemoryMessagesRepository();
    const base = {
      conversacion_id: "c-1",
      lead_session_id: "s-1",
      sender_user_id: null,
      tipo: "text" as const,
      media_url: null,
      idempotency_key: null,
      metadata: {},
    };
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    await messages.create({
      ...base,
      direction: "in",
      sender: "lead",
      contenido: "primero",
      meta_message_id: "w-1",
    });
    vi.setSystemTime(new Date("2026-09-30T10:00:05Z"));
    await messages.create({
      ...base,
      direction: "out",
      sender: "ia",
      contenido: "segundo",
      meta_message_id: "w-2",
    });

    const turno = await buildConversationTurn("c-1", messages, "Quería un filtro", 10);

    expect(turno).toEqual(["[Resumen previo]: Quería un filtro", "lead: primero", "ia: segundo"]);
  });

  test("respeta el límite: se queda con los más recientes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const messages = new InMemoryMessagesRepository();
    for (const [i, contenido] of ["uno", "dos", "tres"].entries()) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 10, 0, i)));
      await messages.create({
        conversacion_id: "c-1",
        lead_session_id: "s-1",
        direction: "in",
        sender: "lead",
        sender_user_id: null,
        tipo: "text",
        contenido,
        media_url: null,
        meta_message_id: `w-${i}`,
        idempotency_key: null,
        metadata: {},
      });
    }

    expect(await buildConversationTurn("c-1", messages, null, 2)).toEqual([
      "lead: dos",
      "lead: tres",
    ]);
  });
});

describe("vehiculosParaAgente", () => {
  const fila = (o: Partial<LeadVehiculo>): LeadVehiculo => ({
    id: "v",
    lead_id: "l-1",
    marca: null,
    modelo: null,
    anio: null,
    motor: null,
    placa: "ABC123",
    placa_original: "ABC-123",
    vin: "VIN1",
    vin_original: "VIN1",
    principal: false,
    created_at: new Date("2026-01-01"),
    ...o,
  });

  test("deja solo marca/modelo/anio/motor y marca el primero como actual", () => {
    expect(
      vehiculosParaAgente([fila({ marca: "Chevrolet", modelo: "Aveo", anio: 2005, motor: "1.6" })]),
    ).toEqual([{ marca: "Chevrolet", modelo: "Aveo", anio: 2005, motor: "1.6", actual: true }]);
  });

  test("el principal va primero y despues el mas nuevo", () => {
    const r = vehiculosParaAgente([
      fila({ modelo: "viejo", created_at: new Date("2026-01-01") }),
      fila({ modelo: "nuevo", created_at: new Date("2026-03-01") }),
      fila({ modelo: "principal", principal: true, created_at: new Date("2025-01-01") }),
    ]);
    expect(r.map((v) => v.modelo)).toEqual(["principal", "nuevo", "viejo"]);
    expect(r.map((v) => v.actual)).toEqual([true, false, false]);
  });

  test("buildRespondInput los pasa y sin ellos la clave no existe", () => {
    const base = {
      leadSessionId: "s-1",
      conversationTurn: [],
      classification: CLASIFICACION,
      mensajeOrigenId: "m-1",
      tramos: [],
    };
    const v = [{ marca: "Kia", modelo: "Rio", anio: 2010, motor: null, actual: true }];
    expect(buildRespondInput({ ...base, vehiculos: v }).vehiculos).toEqual(v);
    expect("vehiculos" in buildRespondInput(base)).toBe(false);
  });
});
