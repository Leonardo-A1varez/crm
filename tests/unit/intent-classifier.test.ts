import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { FakeIntentClassifierLLM } from "../mocks/llm";

describe("IntentClassifierService.classify", () => {
  let intents: InMemoryIntentsRepository;
  let llm: FakeIntentClassifierLLM;
  let svc: DefaultIntentClassifierService;

  beforeEach(() => {
    intents = new InMemoryIntentsRepository();
    llm = new FakeIntentClassifierLLM();
    svc = new DefaultIntentClassifierService(intents, llm);
  });

  test("sin intents activos retorna null con razon", async () => {
    const result = await svc.classify("hola");

    expect(result.intent_nombre).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.razon).toMatch(/sin intents/i);
    expect(llm.calls).toHaveLength(0);
  });

  test("intents inactivos no se mandan al LLM", async () => {
    await intents.create({
      nombre: "saludo",
      descripcion: "saludo inicial",
      ejemplos: ["hola"],
      auto_detectado: false,
      activo: true,
    });
    await intents.create({
      nombre: "obsoleto",
      descripcion: "viejo",
      ejemplos: ["x"],
      auto_detectado: false,
      activo: false,
    });
    llm.enqueue({ intent_nombre: "saludo", confidence: 0.9 });

    await svc.classify("hola");

    expect(llm.calls).toHaveLength(1);
    const candidates = llm.calls[0].candidates.map((c) => c.nombre);
    expect(candidates).toEqual(["saludo"]);
  });

  test("LLM clasifica intent valido reenvia resultado", async () => {
    await intents.create({
      nombre: "pide_precio",
      descripcion: "lead pregunta por precio",
      ejemplos: ["cuanto cuesta"],
      auto_detectado: false,
      activo: true,
    });
    llm.enqueue({ intent_nombre: "pide_precio", confidence: 0.85, razon: "menciona costo" });

    const result = await svc.classify("cuanto sale la pastilla?");

    expect(result.intent_nombre).toBe("pide_precio");
    expect(result.confidence).toBe(0.85);
    expect(result.razon).toBe("menciona costo");
  });

  test("LLM devuelve null se respeta", async () => {
    await intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    llm.enqueue({ intent_nombre: null, confidence: 0.2 });

    const result = await svc.classify("texto raro");

    expect(result.intent_nombre).toBeNull();
    expect(result.confidence).toBe(0.2);
  });

  test("LLM devuelve nombre no en catalogo activo se descarta", async () => {
    await intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    llm.enqueue({ intent_nombre: "alucinado", confidence: 0.99 });

    const result = await svc.classify("hola");

    expect(result.intent_nombre).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.razon).toMatch(/desconocido/i);
  });

  test("input candidates incluye descripcion y ejemplos", async () => {
    await intents.create({
      nombre: "saludo",
      descripcion: "saludo inicial",
      ejemplos: ["hola", "buenas"],
      auto_detectado: false,
      activo: true,
    });
    llm.enqueue({ intent_nombre: "saludo", confidence: 1 });

    await svc.classify("hola");

    expect(llm.calls[0]).toEqual({
      text: "hola",
      candidates: [
        { nombre: "saludo", descripcion: "saludo inicial", ejemplos: ["hola", "buenas"] },
      ],
    });
  });

  test("text pasa intacto al LLM", async () => {
    await intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    llm.enqueue({ intent_nombre: "saludo", confidence: 0.5 });

    await svc.classify("  Hola, ¿hay stock? ");

    expect(llm.calls[0].text).toBe("  Hola, ¿hay stock? ");
  });

  test("intent existente pero inactivo no se acepta aunque LLM lo devuelva", async () => {
    await intents.create({
      nombre: "obsoleto",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: false,
    });
    await intents.create({
      nombre: "saludo",
      descripcion: "",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    llm.enqueue({ intent_nombre: "obsoleto", confidence: 0.9 });

    const result = await svc.classify("texto");

    expect(result.intent_nombre).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
