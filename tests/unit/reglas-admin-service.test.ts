import { beforeEach, describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultReglasAdminService } from "@/server/services/reglas/reglas-admin.service";

describe("DefaultReglasAdminService", () => {
  let intents: InMemoryIntentsRepository;
  let rules: InMemoryRulesRepository;
  let reglasEtiqueta: InMemoryReglasEtiquetaRepository;
  let tags: InMemoryTagsRepository;
  let svc: DefaultReglasAdminService;

  beforeEach(() => {
    intents = new InMemoryIntentsRepository();
    rules = new InMemoryRulesRepository();
    reglasEtiqueta = new InMemoryReglasEtiquetaRepository();
    tags = new InMemoryTagsRepository();
    svc = new DefaultReglasAdminService({ intents, rules, reglasEtiqueta, tags });
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

  describe("reglas de etiquetado", () => {
    test("resuelve los nombres del intent y de la etiqueta", async () => {
      const intent = await svc.crearIntent({
        nombre: "pide_factura",
        descripcion: "",
        ejemplos: [],
      });
      const tag = await tags.create({
        nombre: "Pide factura",
        color: "#3b82f6",
        descripcion: null,
      });
      await svc.crearReglaEtiqueta({ intentId: intent.id, tagId: tag.id });

      const [fila] = await svc.listarReglasEtiqueta();

      expect(fila?.intentNombre).toBe("pide_factura");
      expect(fila?.tagNombre).toBe("Pide factura");
      expect(fila?.tagColor).toBe("#3b82f6");
      expect(fila?.regla.activa).toBe(true);
    });

    test("una etiqueta borrada por SQL no rompe la pantalla", async () => {
      const intent = await svc.crearIntent({ nombre: "x", descripcion: "", ejemplos: [] });
      const tag = await tags.create({ nombre: "temporal", color: "#111111", descripcion: null });
      await svc.crearReglaEtiqueta({ intentId: intent.id, tagId: tag.id });
      // La FK es RESTRICT, asi que esto no pasa por la app; el fallback existe
      // para que un borrado manual no deje la lista sin renderizar.
      await tags.delete(tag.id);

      const [fila] = await svc.listarReglasEtiqueta();

      expect(fila?.tagNombre).toBe("(etiqueta borrada)");
    });

    test("apagar una regla la deja en la lista pero inactiva", async () => {
      const intent = await svc.crearIntent({ nombre: "y", descripcion: "", ejemplos: [] });
      const tag = await tags.create({ nombre: "t", color: "#222222", descripcion: null });
      const regla = await svc.crearReglaEtiqueta({ intentId: intent.id, tagId: tag.id });

      await svc.setReglaEtiquetaActiva(regla.id, false);

      const [fila] = await svc.listarReglasEtiqueta();
      expect(fila?.regla.activa).toBe(false);
    });

    test("borrarla la saca de la lista", async () => {
      const intent = await svc.crearIntent({ nombre: "z", descripcion: "", ejemplos: [] });
      const tag = await tags.create({ nombre: "t2", color: "#333333", descripcion: null });
      const regla = await svc.crearReglaEtiqueta({ intentId: intent.id, tagId: tag.id });

      await svc.borrarReglaEtiqueta(regla.id);

      expect(await svc.listarReglasEtiqueta()).toEqual([]);
    });
  });
});
