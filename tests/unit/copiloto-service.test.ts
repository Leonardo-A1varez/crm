import { describe, expect, test, vi } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultCopilotoService } from "@/server/services/copiloto/copiloto.service";
import { DIAS_SEMANA, type AgenteConfigValores, type Horario } from "@/types/agente";
import type { Canal } from "@/types/domain";

const USER = "99999999-9999-4999-8999-999999999999";
const SESION = "88888888-8888-4888-8888-888888888888";
const LEAD = "77777777-7777-4777-8777-777777777777";

function horario(abierto: boolean): Horario {
  const h = {} as Horario;
  for (const dia of DIAS_SEMANA) h[dia] = abierto ? [{ desde: "00:00", hasta: "23:59" }] : [];
  return h;
}

async function makeCtx(config: Partial<AgenteConfigValores> = {}, canal: Canal = "wa") {
  const conversations = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const rules = new InMemoryRulesRepository();
  const borradores = new InMemoryBorradoresIaRepository();
  const solicitarRegeneracion = vi.fn(async () => {});
  const service = new DefaultCopilotoService({
    borradores,
    conversations,
    messages,
    rules,
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ...config }),
    solicitarRegeneracion,
    now: () => new Date("2026-09-28T15:00:00Z"),
  });
  const conv = await conversations.create({
    lead_id: LEAD,
    canal,
    canal_thread_id: "5491155551234",
  });
  const entrante = await messages.create({
    conversacion_id: conv.id,
    lead_session_id: SESION,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "Busco filtro",
    media_url: null,
    meta_message_id: "wamid.IN-1",
    idempotency_key: null,
    metadata: {},
  });

  async function borradorListo(
    texto = "Borrador de la IA",
    origen: "ia" | "regla" = "ia",
    reglaId: string | null = null,
  ) {
    const r = await borradores.iniciar({
      conversacionId: conv.id,
      leadSessionId: SESION,
      mensajeOrigenId: entrante.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");
    await borradores.completar(r.borradorId, { contenido: texto, origen, reglaId });
    return r.borradorId;
  }
  return {
    service,
    conversations,
    messages,
    rules,
    borradores,
    conv,
    entrante,
    borradorListo,
    solicitarRegeneracion,
  };
}

describe("CopilotoService.estado", () => {
  test("sin borrador: modo efectivo según los horarios (equipo de turno = Copiloto)", async () => {
    const ctx = await makeCtx({ horario_equipo: horario(true) });

    const e = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: ctx.entrante.id,
    });

    expect(e).toEqual({
      conversacionId: ctx.conv.id,
      override: null,
      modoEfectivo: "copiloto",
      borrador: null,
    });
  });

  test("con el equipo sin rangos y el agente abierto el modo efectivo es Automático", async () => {
    const ctx = await makeCtx();
    expect(
      (await ctx.service.estado({ conversacionId: ctx.conv.id, ultimoEntranteId: null }))
        .modoEfectivo,
    ).toBe("automatico");
  });

  test("el override manda sobre los horarios", async () => {
    const ctx = await makeCtx({ horario_equipo: horario(true) });
    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: "automatico" });

    const e = await ctx.service.estado({ conversacionId: ctx.conv.id, ultimoEntranteId: null });

    expect(e.override).toBe("automatico");
    expect(e.modoEfectivo).toBe("automatico");
  });

  test("en Instagram el copiloto no aplica: ni el override ni el equipo cambian el modo", async () => {
    const ctx = await makeCtx({ horario_equipo: horario(true) }, "ig");
    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: "copiloto" });

    const e = await ctx.service.estado({ conversacionId: ctx.conv.id, ultimoEntranteId: null });

    expect(e.modoEfectivo).toBe("automatico");
  });

  test("devuelve el borrador listo con el nombre de la regla cuando el origen es una regla", async () => {
    const ctx = await makeCtx();
    const regla = await ctx.rules.create({
      intent_id: crypto.randomUUID(),
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Abrimos de 9 a 18\nLunes a viernes",
      prioridad: 0,
      activa: true,
    });
    const id = await ctx.borradorListo("Abrimos de 9 a 18", "regla", regla.id);

    const e = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: ctx.entrante.id,
    });

    expect(e.borrador).toMatchObject({
      id,
      estado: "listo",
      contenido: "Abrimos de 9 a 18",
      origen: "regla",
      reglaNombre: "Abrimos de 9 a 18",
    });
    expect(typeof e.borrador?.creadoAt).toBe("string");
  });

  test("un borrador usado cuyo entrante ya no es el último no se muestra", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    await ctx.borradores.marcarUsado(id, { via: "copiar", usuarioId: USER });

    const vigente = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: ctx.entrante.id,
    });
    const viejo = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: crypto.randomUUID(),
    });

    expect(vigente.borrador?.estado).toBe("usado");
    expect(viejo.borrador).toBeNull();
  });

  test("una conversación inexistente es NotFoundError", async () => {
    const ctx = await makeCtx();
    await expect(
      ctx.service.estado({ conversacionId: crypto.randomUUID(), ultimoEntranteId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CopilotoService.cambiarModo", () => {
  test("fija el override y null vuelve a Según horario", async () => {
    const ctx = await makeCtx();
    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: "copiloto" });
    expect((await ctx.conversations.findById(ctx.conv.id))?.modo_respuesta_override).toBe(
      "copiloto",
    );

    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: null });
    expect((await ctx.conversations.findById(ctx.conv.id))?.modo_respuesta_override).toBeNull();
  });
});

describe("CopilotoService.usar", () => {
  test("Insertar guarda el texto final como saliente humano 'sin confirmar' y marca el borrador usado", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo("Texto original");

    const r = await ctx.service.usar({
      borradorId: id,
      via: "insertar",
      texto: "  Texto editado  ",
      userId: USER,
    });

    expect(r).toEqual({ yaUsado: false });
    const saliente = await ctx.messages.findByIdempotencyKey(`copiloto:${id}`);
    expect(saliente).toMatchObject({
      conversacion_id: ctx.conv.id,
      lead_session_id: SESION,
      direction: "out",
      sender: "humano",
      sender_user_id: USER,
      tipo: "text",
      contenido: "Texto editado",
      meta_message_id: null,
      metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: id },
    });
    expect(await ctx.borradores.findById(id)).toMatchObject({
      estado: "usado",
      usado_via: "insertar",
      usado_por: USER,
    });
  });

  test("tocar dos botones sobre el mismo borrador no duplica el mensaje", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await ctx.service.usar({ borradorId: id, via: "copiar", texto: "Hola", userId: USER });
    const segunda = await ctx.service.usar({
      borradorId: id,
      via: "abrir_web",
      texto: "Hola",
      userId: USER,
    });

    expect(segunda).toEqual({ yaUsado: true });
    const salientes = (await ctx.messages.listByConversacion(ctx.conv.id)).filter(
      (m) => m.direction === "out",
    );
    expect(salientes).toHaveLength(1);
  });

  test("si el saliente ya existía (reintento tras un corte), no falla y igual marca usado", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    await ctx.messages.create({
      conversacion_id: ctx.conv.id,
      lead_session_id: SESION,
      direction: "out",
      sender: "humano",
      sender_user_id: USER,
      tipo: "text",
      contenido: "Hola",
      media_url: null,
      meta_message_id: null,
      idempotency_key: `copiloto:${id}`,
      metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: id },
    });

    const r = await ctx.service.usar({
      borradorId: id,
      via: "copiar",
      texto: "Hola",
      userId: USER,
    });

    expect(r).toEqual({ yaUsado: false });
    expect((await ctx.borradores.findById(id))?.estado).toBe("usado");
  });

  test("'Al composer' no guarda el saliente sin confirmar: lo crea sendMessageAction", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await ctx.service.usar({ borradorId: id, via: "al_composer", texto: "Hola", userId: USER });

    expect(await ctx.messages.findByIdempotencyKey(`copiloto:${id}`)).toBeNull();
    expect((await ctx.borradores.findById(id))?.usado_via).toBe("al_composer");
  });

  test("un borrador que no está listo es ConflictError", async () => {
    const ctx = await makeCtx();
    const r = await ctx.borradores.iniciar({
      conversacionId: ctx.conv.id,
      leadSessionId: SESION,
      mensajeOrigenId: ctx.entrante.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");

    await expect(
      ctx.service.usar({ borradorId: r.borradorId, via: "copiar", texto: "Hola", userId: USER }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("texto vacío o de más de 4096 caracteres es ValidationError y no consume el borrador", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await expect(
      ctx.service.usar({ borradorId: id, via: "copiar", texto: "   ", userId: USER }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ctx.service.usar({ borradorId: id, via: "copiar", texto: "a".repeat(4097), userId: USER }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await ctx.borradores.findById(id))?.estado).toBe("listo");
  });

  test("un ConflictError que no es el saliente duplicado (FK u otro) se propaga y no marca usado", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    vi.spyOn(ctx.messages, "create").mockRejectedValueOnce(
      new ConflictError("sesión inexistente", "foreign_key_violation"),
    );

    await expect(
      ctx.service.usar({ borradorId: id, via: "copiar", texto: "Hola", userId: USER }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await ctx.borradores.findById(id))?.estado).toBe("listo");
  });

  test("si el borrador deja de estar vigente entre la lectura y la marca, es resultado benigno", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    vi.spyOn(ctx.borradores, "marcarUsado").mockResolvedValueOnce("no_disponible");

    const r = await ctx.service.usar({
      borradorId: id,
      via: "copiar",
      texto: "Hola",
      userId: USER,
    });

    expect(r).toEqual({ yaUsado: true });
  });

  test("marca el uso con el usuario autenticado y no persiste el texto editado en el borrador", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo("Original");

    await ctx.service.usar({ borradorId: id, via: "copiar", texto: "Editado", userId: USER });

    expect(await ctx.borradores.findById(id)).toMatchObject({
      contenido: "Original",
      usado_por: USER,
    });
  });

  test("un borrador inexistente es NotFoundError", async () => {
    const ctx = await makeCtx();
    await expect(
      ctx.service.usar({
        borradorId: crypto.randomUUID(),
        via: "copiar",
        texto: "Hola",
        userId: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CopilotoService.solicitarRegeneracion", () => {
  test("un borrador listo emite el pedido con los ids y quién lo pidió", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await ctx.service.solicitarRegeneracion({ borradorId: id, userId: USER });

    expect(ctx.solicitarRegeneracion).toHaveBeenCalledWith({
      borradorId: id,
      conversacionId: ctx.conv.id,
      solicitadoPor: USER,
    });
  });

  test("un borrador en error se puede reintentar", async () => {
    const ctx = await makeCtx();
    const r = await ctx.borradores.iniciar({
      conversacionId: ctx.conv.id,
      leadSessionId: SESION,
      mensajeOrigenId: ctx.entrante.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");
    await ctx.borradores.marcarError(r.borradorId, "llm_error");

    await ctx.service.solicitarRegeneracion({ borradorId: r.borradorId, userId: null });

    expect(ctx.solicitarRegeneracion).toHaveBeenCalledTimes(1);
  });

  test("un borrador inexistente es NotFoundError y no emite", async () => {
    const ctx = await makeCtx();

    await expect(
      ctx.service.solicitarRegeneracion({ borradorId: crypto.randomUUID(), userId: USER }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ctx.solicitarRegeneracion).not.toHaveBeenCalled();
  });

  test("uno ya usado o que se está redactando es ConflictError y no emite", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    await ctx.borradores.marcarUsado(id, { via: "copiar", usuarioId: USER });

    await expect(
      ctx.service.solicitarRegeneracion({ borradorId: id, userId: USER }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(ctx.solicitarRegeneracion).not.toHaveBeenCalled();
  });
});
