import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import type { Intent, Regla } from "@/types/entities";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";

async function seedIntent(
  intents: InMemoryIntentsRepository,
  partial: Partial<Omit<Intent, "id">> & { nombre: string },
): Promise<Intent> {
  return intents.create({
    nombre: partial.nombre,
    descripcion: partial.descripcion ?? "",
    ejemplos: partial.ejemplos ?? [],
    auto_detectado: partial.auto_detectado ?? false,
    activo: partial.activo ?? true,
  });
}

async function seedRegla(
  rules: InMemoryRulesRepository,
  partial: Partial<Omit<Regla, "id" | "created_at">> & { intent_id: string },
): Promise<Regla> {
  return rules.create({
    intent_id: partial.intent_id,
    condiciones_extra: partial.condiciones_extra ?? null,
    respuesta_tipo: partial.respuesta_tipo ?? "text",
    respuesta_contenido: partial.respuesta_contenido ?? "respuesta default",
    prioridad: partial.prioridad ?? 0,
    activa: partial.activa ?? true,
  });
}

describe("RuleEngineService.match", () => {
  let intents: InMemoryIntentsRepository;
  let rules: InMemoryRulesRepository;
  let reglasEtiqueta: InMemoryReglasEtiquetaRepository;
  let svc: DefaultRuleEngineService;

  beforeEach(() => {
    intents = new InMemoryIntentsRepository();
    rules = new InMemoryRulesRepository();
    reglasEtiqueta = new InMemoryReglasEtiquetaRepository();
    svc = new DefaultRuleEngineService(intents, rules, reglasEtiqueta);
  });

  test("intent_nombre null retorna null", async () => {
    const result = await svc.match({ intent_nombre: null, context: {} });
    expect(result).toBeNull();
  });

  test("intent inexistente retorna null", async () => {
    const result = await svc.match({ intent_nombre: "fantasma", context: {} });
    expect(result).toBeNull();
  });

  test("intent inactivo retorna null", async () => {
    await seedIntent(intents, { nombre: "saludo", activo: false });
    const result = await svc.match({ intent_nombre: "saludo", context: {} });
    expect(result).toBeNull();
  });

  test("sin reglas activas retorna null", async () => {
    await seedIntent(intents, { nombre: "saludo" });
    const result = await svc.match({ intent_nombre: "saludo", context: {} });
    expect(result).toBeNull();
  });

  test("regla sin condiciones_extra matchea siempre", async () => {
    const i = await seedIntent(intents, { nombre: "saludo" });
    const r = await seedRegla(rules, {
      intent_id: i.id,
      condiciones_extra: null,
      respuesta_contenido: "Hola!",
    });

    const result = await svc.match({ intent_nombre: "saludo", context: { stage: "nuevo" } });

    expect(result).not.toBeNull();
    expect(result!.regla_id).toBe(r.id);
    expect(result!.intent_id).toBe(i.id);
    expect(result!.respuesta_contenido).toBe("Hola!");
    expect(result!.respuesta_tipo).toBe("text");
  });

  test("condiciones_extra matchea subset context", async () => {
    const i = await seedIntent(intents, { nombre: "pide_precio" });
    await seedRegla(rules, {
      intent_id: i.id,
      condiciones_extra: { current_stage: "nuevo" },
      respuesta_contenido: "Precio inicial",
    });

    const result = await svc.match({
      intent_nombre: "pide_precio",
      context: { current_stage: "nuevo", urgencia: "alta" },
    });

    expect(result).not.toBeNull();
    expect(result!.respuesta_contenido).toBe("Precio inicial");
  });

  test("condiciones_extra mismatch retorna null", async () => {
    const i = await seedIntent(intents, { nombre: "pide_precio" });
    await seedRegla(rules, {
      intent_id: i.id,
      condiciones_extra: { current_stage: "nuevo" },
      respuesta_contenido: "Precio",
    });

    const result = await svc.match({
      intent_nombre: "pide_precio",
      context: { current_stage: "cotizado" },
    });

    expect(result).toBeNull();
  });

  test("prioridad DESC: regla mayor prioridad gana", async () => {
    const i = await seedIntent(intents, { nombre: "obj_precio" });
    await seedRegla(rules, {
      intent_id: i.id,
      prioridad: 1,
      respuesta_contenido: "Baja prioridad",
    });
    await seedRegla(rules, {
      intent_id: i.id,
      prioridad: 10,
      respuesta_contenido: "Alta prioridad",
    });

    const result = await svc.match({ intent_nombre: "obj_precio", context: {} });

    expect(result!.respuesta_contenido).toBe("Alta prioridad");
  });

  test("primera regla cuyas condiciones matchea gana (no la primera del orden)", async () => {
    const i = await seedIntent(intents, { nombre: "x" });
    await seedRegla(rules, {
      intent_id: i.id,
      prioridad: 10,
      condiciones_extra: { stage: "cotizado" },
      respuesta_contenido: "Para cotizado",
    });
    await seedRegla(rules, {
      intent_id: i.id,
      prioridad: 5,
      condiciones_extra: null,
      respuesta_contenido: "Catch-all",
    });

    const result = await svc.match({ intent_nombre: "x", context: { stage: "nuevo" } });

    expect(result!.respuesta_contenido).toBe("Catch-all");
  });

  test("regla activa=false se ignora", async () => {
    const i = await seedIntent(intents, { nombre: "saludo" });
    await seedRegla(rules, {
      intent_id: i.id,
      activa: false,
      respuesta_contenido: "inactiva",
    });

    const result = await svc.match({ intent_nombre: "saludo", context: {} });

    expect(result).toBeNull();
  });

  test("condiciones_extra valor objeto matchea por deep-equal", async () => {
    const i = await seedIntent(intents, { nombre: "x" });
    await seedRegla(rules, {
      intent_id: i.id,
      condiciones_extra: { meta: { canal: "wa" } },
      respuesta_contenido: "wa rule",
    });

    const matchOk = await svc.match({
      intent_nombre: "x",
      context: { meta: { canal: "wa" }, extra: "ignore" },
    });
    expect(matchOk!.respuesta_contenido).toBe("wa rule");

    const matchFail = await svc.match({
      intent_nombre: "x",
      context: { meta: { canal: "ig" } },
    });
    expect(matchFail).toBeNull();
  });

  test("output expone regla_id intent_id respuesta_tipo respuesta_contenido", async () => {
    const i = await seedIntent(intents, { nombre: "saludo" });
    const r = await seedRegla(rules, {
      intent_id: i.id,
      respuesta_tipo: "handoff",
      respuesta_contenido: "Pasando a humano",
    });

    const result = await svc.match({ intent_nombre: "saludo", context: {} });

    expect(result).toEqual({
      regla_id: r.id,
      intent_id: i.id,
      respuesta_tipo: "handoff",
      respuesta_contenido: "Pasando a humano",
    });
  });

  // A diferencia de las reglas que contestan —donde gana una sola, la de mayor
  // prioridad, y el LLM ni se llama— estas no compiten por ningun lugar: el turno
  // sigue igual y el lead puede quedar con varias etiquetas del mismo mensaje.
  describe("RuleEngineService.etiquetasPara", () => {
    const TAG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const TAG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    test("sin intent no hay etiquetas", async () => {
      expect(await svc.etiquetasPara({ intent_nombre: null, context: {} })).toEqual([]);
    });

    test("aplican TODAS las que matchean, no la primera", async () => {
      const intent = await seedIntent(intents, { nombre: "consulta_precio" });
      await reglasEtiqueta.create({
        intent_id: intent.id,
        tag_id: TAG_A,
        condiciones_extra: null,
        activa: true,
      });
      await reglasEtiqueta.create({
        intent_id: intent.id,
        tag_id: TAG_B,
        condiciones_extra: null,
        activa: true,
      });

      const tags = await svc.etiquetasPara({ intent_nombre: intent.nombre, context: {} });

      expect(tags).toEqual([TAG_A, TAG_B]);
    });

    test("una regla desactivada no etiqueta", async () => {
      const intent = await seedIntent(intents, { nombre: "consulta_precio" });
      await reglasEtiqueta.create({
        intent_id: intent.id,
        tag_id: TAG_A,
        condiciones_extra: null,
        activa: false,
      });

      expect(await svc.etiquetasPara({ intent_nombre: intent.nombre, context: {} })).toEqual([]);
    });

    test("las condiciones extra se evaluan igual que en match", async () => {
      const intent = await seedIntent(intents, { nombre: "consulta_precio" });
      await reglasEtiqueta.create({
        intent_id: intent.id,
        tag_id: TAG_A,
        condiciones_extra: { urgencia: "alta" },
        activa: true,
      });

      expect(
        await svc.etiquetasPara({ intent_nombre: intent.nombre, context: { urgencia: "media" } }),
      ).toEqual([]);
      expect(
        await svc.etiquetasPara({ intent_nombre: intent.nombre, context: { urgencia: "alta" } }),
      ).toEqual([TAG_A]);
    });

    test("un intent inactivo no etiqueta", async () => {
      const intent = await seedIntent(intents, { nombre: "consulta_precio", activo: false });
      await reglasEtiqueta.create({
        intent_id: intent.id,
        tag_id: TAG_A,
        condiciones_extra: null,
        activa: true,
      });

      expect(await svc.etiquetasPara({ intent_nombre: intent.nombre, context: {} })).toEqual([]);
    });
  });
});
