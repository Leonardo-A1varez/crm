import { describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { DIAS_SEMANA, EMOJIS, LARGO, POLITICA_TOPE, TONO } from "@/types/agente";

describe("CONFIG_DE_FABRICA", () => {
  test("reproduce los valores hoy hardcodeados en el codigo", () => {
    // Si alguno de estos cambia, la migracion semilla cambia el comportamiento
    // del agente en silencio. Ver spec seccion 3.3.
    expect(CONFIG_DE_FABRICA.modelo).toBe("gpt-4o-mini"); // DEFAULT_OPENAI_MODEL
    expect(CONFIG_DE_FABRICA.max_pasos_tool).toBe(5); // DEFAULT_MAX_STEPS
    expect(CONFIG_DE_FABRICA.ventana_contexto_mensajes).toBe(10); // RECENT_TURN_LIMIT
    expect(CONFIG_DE_FABRICA.umbral_resumen_turnos).toBe(20); // DEFAULT_SUMMARY_THRESHOLD
    expect(CONFIG_DE_FABRICA.tope_gasto_diario_usd).toBe(10); // LLM_DAILY_CAP_USD
  });

  test("el estilo de fabrica describe el SYSTEM_PROMPT actual", () => {
    // El prompt actual tutea y pide respuestas cortas.
    expect(CONFIG_DE_FABRICA.tono).toBe("cercano");
    expect(CONFIG_DE_FABRICA.largo).toBe("corto");
    expect(CONFIG_DE_FABRICA.emojis).toBe("nunca");
  });

  test("no ofrece descuentos ni instrucciones de negocio", () => {
    expect(CONFIG_DE_FABRICA.descuento_max_pct).toBe(0);
    expect(CONFIG_DE_FABRICA.instrucciones).toBe("");
  });

  test("la politica de tope es pausar, la conservadora", () => {
    expect(CONFIG_DE_FABRICA.politica_tope).toBe("pausar");
  });

  test("el horario de fabrica es 24/7: hoy no hay restriccion horaria", () => {
    for (const dia of DIAS_SEMANA) {
      expect(CONFIG_DE_FABRICA.horario[dia]).toEqual([{ desde: "00:00", hasta: "23:59" }]);
    }
  });

  test("la timezone de fabrica es explicita, no heredada del server", () => {
    expect(CONFIG_DE_FABRICA.horario_timezone).toBe("America/Argentina/Buenos_Aires");
  });

  test("los valores de union pertenecen a sus listas", () => {
    expect(TONO).toContain(CONFIG_DE_FABRICA.tono);
    expect(LARGO).toContain(CONFIG_DE_FABRICA.largo);
    expect(EMOJIS).toContain(CONFIG_DE_FABRICA.emojis);
    expect(POLITICA_TOPE).toContain(CONFIG_DE_FABRICA.politica_tope);
  });
});

describe("listas de dominio", () => {
  test("DIAS_SEMANA tiene los 7 dias en orden de semana", () => {
    expect(DIAS_SEMANA).toEqual(["lun", "mar", "mie", "jue", "vie", "sab", "dom"]);
  });

  test("las uniones tienen los valores del spec", () => {
    expect(TONO).toEqual(["formal", "neutro", "cercano"]);
    expect(LARGO).toEqual(["corto", "medio", "detallado"]);
    expect(EMOJIS).toEqual(["nunca", "ocasional", "libre"]);
    expect(POLITICA_TOPE).toEqual(["pausar", "solo_reglas", "seguir"]);
  });
});
