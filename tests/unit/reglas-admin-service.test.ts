import { beforeEach, describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { DefaultReglasAdminService } from "@/server/services/reglas/reglas-admin.service";

describe("DefaultReglasAdminService", () => {
  let intents: InMemoryIntentsRepository;
  let rules: InMemoryRulesRepository;
  let svc: DefaultReglasAdminService;

  beforeEach(() => {
    intents = new InMemoryIntentsRepository();
    rules = new InMemoryRulesRepository();
    svc = new DefaultReglasAdminService({ intents, rules });
  });

  test("un intent nuevo arranca activo y no marcado como auto-detectado", async () => {
    const i = await svc.crearIntent({ nombre: "saludo", descripcion: "hola", ejemplos: ["hola"] });

    expect(i.activo).toBe(true);
    expect(i.auto_detectado).toBe(false);
  });

  test("los ejemplos en blanco se descartan", async () => {
    const i = await svc.crearIntent({
      nombre: "saludo",
      descripcion: "",
      ejemplos: ["hola", "   ", "", "buenas"],
    });

    expect(i.ejemplos).toEqual(["hola", "buenas"]);
  });

  test("dos intents con el mismo nombre no pueden convivir", async () => {
    await svc.crearIntent({ nombre: "saludo", descripcion: "", ejemplos: [] });

    // El clasificador matchea por nombre: con dos homónimos, las reglas del
    // segundo no se alcanzarían nunca.
    await expect(
      svc.crearIntent({ nombre: "saludo", descripcion: "", ejemplos: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("el conteo separa reglas activas de totales", async () => {
    const i = await svc.crearIntent({ nombre: "saludo", descripcion: "", ejemplos: [] });
    const r1 = await svc.crearRegla({
      intentId: i.id,
      respuestaTipo: "text",
      respuestaContenido: "hola!",
      prioridad: 0,
    });
    await svc.crearRegla({
      intentId: i.id,
      respuestaTipo: "text",
      respuestaContenido: "buenas!",
      prioridad: 5,
    });
    await svc.setReglaActiva(r1.id, false);

    const [fila] = await svc.listarIntents();

    expect(fila).toMatchObject({ reglasActivas: 1, reglasTotales: 2 });
  });

  test("las reglas se listan en el mismo orden en que las evalúa el motor", async () => {
    const i = await svc.crearIntent({ nombre: "saludo", descripcion: "", ejemplos: [] });
    await svc.crearRegla({
      intentId: i.id,
      respuestaTipo: "text",
      respuestaContenido: "la de prioridad baja",
      prioridad: 1,
    });
    await svc.crearRegla({
      intentId: i.id,
      respuestaTipo: "text",
      respuestaContenido: "la de prioridad alta",
      prioridad: 9,
    });

    const filas = await svc.listarReglas();

    expect(filas.map((f) => f.regla.respuesta_contenido)).toEqual([
      "la de prioridad alta",
      "la de prioridad baja",
    ]);
  });

  test("desactivar un intent no borra sus reglas", async () => {
    const i = await svc.crearIntent({ nombre: "saludo", descripcion: "", ejemplos: [] });
    await svc.crearRegla({
      intentId: i.id,
      respuestaTipo: "handoff",
      respuestaContenido: "pasa a humano",
      prioridad: 0,
    });

    await svc.setIntentActivo(i.id, false);

    const [fila] = await svc.listarIntents();
    expect(fila?.intent.activo).toBe(false);
    expect(fila?.reglasActivas).toBe(1);
  });
});
