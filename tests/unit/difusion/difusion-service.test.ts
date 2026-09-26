import { describe, expect, test, vi } from "vitest";
import {
  BudgetExceededError,
  ConflictError,
  IllegalStateError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { Grupo } from "@/lib/ui/condiciones";
import type { CandidatoResuelto } from "@/server/repositories/difusion-audiencia.repo";
import { InMemoryAdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import {
  InMemoryDifusionEnviosRepository,
  type DifusionEnvioInsert,
} from "@/server/repositories/difusion-envios.repo";
import { InMemoryDifusionProgramacionRepository } from "@/server/repositories/difusion-programacion.repo";
import { hasherBajasDesde } from "@/server/repositories/difusion-supresiones.hash";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import {
  DefaultDifusionService,
  LIMITE_LISTADO,
  type AlcanceInput,
  type DifusionServiceDeps,
  type LecturaTope,
} from "@/server/services/difusion/difusion.service";
import {
  FakeDifusionAudienciaRepository,
  candidato,
  leadIdDe,
  telefonoDe,
} from "../../helpers/difusion-fakes";

// El reloj de verdad: los repos en memoria sellan fechas con Date.now(), y el
// servicio tiene que ver las mismas.
const AHORA = new Date();
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

const ADMIN = "00000000-0000-4000-8000-00000000a001";
/** Una difusión que sale necesita plantilla e idioma (CHECK de la tabla). */
const CON_PLANTILLA = {
  plantilla_nombre: "promo_frenos_v3",
  plantilla_categoria: "marketing",
  plantilla_idioma: "es",
} as const;

const ARBOL: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "canal",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["wa"] },
    },
  ],
};
const VACIO: Grupo = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };

const ALCANCE: AlcanceInput = {
  audiencia: ARBOL,
  todaLaBase: false,
  incluirEnNegociacion: false,
  exentaTopeFrecuencia: false,
  plantillaCategoria: "marketing",
  muestra: { desde: 0, limite: 12 },
};

function armar(
  opciones: {
    candidatos?: CandidatoResuelto[];
    tope?: LecturaTope;
    usoCupo?: number;
    maxSalientes?: number;
    logger?: Logger;
    supresiones?: InMemoryDifusionSupresionesRepository;
    datosDelLead?: DifusionServiceDeps["datosDelLead"];
    leerRespuestas?: DifusionServiceDeps["leerRespuestas"];
  } = {},
) {
  const difusiones = new InMemoryDifusionesRepository();
  const envios = new InMemoryDifusionEnviosRepository();
  const supresiones = opciones.supresiones ?? new InMemoryDifusionSupresionesRepository();
  const audiencia = new FakeDifusionAudienciaRepository(
    opciones.candidatos ?? [],
    opciones.usoCupo ?? 0,
  );
  const programacion = new InMemoryDifusionProgramacionRepository(difusiones, envios);
  const tags = new InMemoryTagsRepository();
  const usuarios = new InMemoryUsersRepository();
  const avisarProgramada = vi.fn(async () => {});
  const avisarReanudada = vi.fn(async () => {});
  const audit = new InMemoryAdminAuditRepository();
  const svc = new DefaultDifusionService({
    audit,
    difusiones,
    envios,
    supresiones,
    audiencia,
    programacion,
    tags,
    usuarios,
    leerTopeMensajeria: async () => opciones.tope ?? { estado: "ok", tope: 250 },
    leerMaxSalientes24h: async () => opciones.maxSalientes ?? 3,
    avisarProgramada,
    avisarReanudada,
    datosDelLead: opciones.datosDelLead,
    leerRespuestas: opciones.leerRespuestas,
    logger: opciones.logger ?? new NoopLogger(),
    ahora: () => AHORA,
  });
  return {
    svc,
    difusiones,
    envios,
    supresiones,
    audiencia,
    programacion,
    tags,
    usuarios,
    avisarProgramada,
    avisarReanudada,
    audit,
  };
}

function filaEnCola(difusionId: string, n: number): DifusionEnvioInsert {
  return {
    difusion_id: difusionId,
    lead_id: leadIdDe(n),
    telefono: telefonoDe(n),
    estado: "en_cola",
    motivo_exclusion: null,
    ruta: "plantilla",
    tanda: 0,
    programado_para: AHORA,
  };
}

function filaExcluida(difusionId: string, n: number): DifusionEnvioInsert {
  return {
    difusion_id: difusionId,
    lead_id: leadIdDe(n),
    telefono: telefonoDe(n),
    estado: "excluido",
    motivo_exclusion: "baja_propia",
    ruta: null,
    tanda: null,
    programado_para: null,
  };
}

/**
 * Un lead por cada camino del planificador. El 9 comparte teléfono con el 2 en
 * otro formato: para Meta son la misma persona.
 */
function zoologico(): CandidatoResuelto[] {
  return [
    candidato(1, { ultimoEntranteAt: hace(2 * HORA), vehiculo: "Chevrolet Aveo 2012" }),
    candidato(2),
    candidato(3, { telefono: "ig:123" }),
    candidato(4),
    candidato(5, { etapaActiva: "requiere_humano" }),
    candidato(6, { etapaActiva: "cotizado", ultimoEntranteAt: hace(10 * MINUTO) }),
    candidato(7, { etapaActiva: "negociando" }),
    candidato(8, { salientesAutomaticos24h: 3 }),
    candidato(9, { telefono: `+${telefonoDe(2)}` }),
  ];
}

async function borradorConPlantilla(
  svc: DefaultDifusionService,
  over: { audiencia?: Grupo; todaLaBase?: boolean } = {},
) {
  const d = await svc.crearBorrador(
    {
      nombre: "Promo frenos",
      audiencia: over.audiencia ?? ARBOL,
      todaLaBase: over.todaLaBase ?? false,
      modo: "congelada",
      incluirEnNegociacion: false,
      exentaTopeFrecuencia: false,
    },
    ADMIN,
  );
  await svc.guardarBorrador(
    d.id,
    {
      plantilla: {
        nombre: "promo_frenos_v3",
        categoria: "marketing",
        idioma: "es",
        parametros: [],
      },
    },
    ADMIN,
  );
  return d;
}

describe("DifusionService — borradores", () => {
  test("crea un borrador con su audiencia, modo, exenciones y autor", async () => {
    const { svc } = armar();

    const d = await svc.crearBorrador(
      {
        nombre: "  Promo frenos  ",
        audiencia: ARBOL,
        todaLaBase: false,
        modo: "dinamica",
        incluirEnNegociacion: true,
        exentaTopeFrecuencia: false,
      },
      ADMIN,
    );

    expect(d).toMatchObject({
      nombre: "Promo frenos",
      estado: "borrador",
      audiencia: ARBOL,
      audiencia_toda_la_base: false,
      audiencia_modo: "dinamica",
      incluir_en_negociacion: true,
      exenta_tope_frecuencia: false,
      creada_por: ADMIN,
    });
  });

  test("toda la base con condiciones se rechaza", async () => {
    const { svc } = armar();
    await expect(
      svc.crearBorrador(
        {
          nombre: "x",
          audiencia: ARBOL,
          todaLaBase: true,
          modo: "congelada",
          incluirEnNegociacion: false,
          exentaTopeFrecuencia: false,
        },
        ADMIN,
      ),
    ).rejects.toThrow(ValidationError);
  });

  test("guarda plantilla y nombre del borrador", async () => {
    const { svc } = armar();
    const d = await borradorConPlantilla(svc);

    const u = await svc.guardarBorrador(d.id, { nombre: "Otra" }, ADMIN);

    expect(u.nombre).toBe("Otra");
    expect(u.plantilla_nombre).toBe("promo_frenos_v3");
    expect(u.plantilla_categoria).toBe("marketing");
  });

  test("una difusión que ya no es borrador no se edita", async () => {
    const { svc } = armar({ candidatos: [candidato(1)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: null });

    await expect(svc.guardarBorrador(d.id, { nombre: "Otra" }, ADMIN)).rejects.toThrow(
      ConflictError,
    );
  });

  test("una que no existe es NotFoundError", async () => {
    const { svc } = armar();
    await expect(
      svc.guardarBorrador("00000000-0000-4000-8000-000000000999", { nombre: "x" }, ADMIN),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("DifusionService — alcance", () => {
  test("un árbol vacío sin elegir toda la base se rechaza sin consultar la base", async () => {
    const { svc, audiencia } = armar();
    await expect(svc.calcularAlcance({ ...ALCANCE, audiencia: VACIO })).rejects.toThrow(
      ValidationError,
    );
    expect(audiencia.pedidas).toHaveLength(0);
  });

  test("toda la base elegida se resuelve como tal", async () => {
    const { svc, audiencia } = armar({ candidatos: [candidato(1)] });
    await svc.calcularAlcance({ ...ALCANCE, audiencia: VACIO, todaLaBase: true });
    expect(audiencia.pedidas).toEqual([{ tipo: "toda_la_base" }]);
  });

  test("cuenta quiénes coinciden, quiénes reciben y por qué motivo sale cada excluido", async () => {
    const { svc, supresiones } = armar({ candidatos: zoologico() });
    await supresiones.registrar({
      telefono: telefonoDe(4),
      origen: "palabra_clave",
      detalle: "BAJA",
    });

    const a = await svc.calcularAlcance(ALCANCE);

    expect(a.audienciaInicial).toBe(9);
    expect(a.destinatarios).toBe(2);
    expect(a.porRuta).toEqual({ ventana_abierta: 1, plantilla: 1 });
    const porMotivo = Object.fromEntries(a.exclusiones.map((e) => [e.motivo, e.cantidad]));
    expect(porMotivo).toMatchObject({
      sin_telefono: 1,
      duplicado_telefono: 1,
      baja_propia: 1,
      requiere_humano: 1,
      conversacion_activa: 1,
      en_negociacion: 1,
      cap_frecuencia: 1,
      baja_meta: 0,
      sin_ventana: 0,
      saturado_meta: 0,
    });
  });

  // El backend decide qué exclusiones se pueden desmarcar: sólo las dos que la
  // difusión guarda como exención auditada.
  test("sólo en negociación y tope de frecuencia son eximibles", async () => {
    const { svc } = armar({ candidatos: zoologico() });
    const a = await svc.calcularAlcance(ALCANCE);
    const eximibles = a.exclusiones.filter((e) => e.eximible).map((e) => e.motivo);
    expect(eximibles.sort()).toEqual(["cap_frecuencia", "en_negociacion"]);
    expect(a.exclusiones.every((e) => e.aplicada)).toBe(true);
  });

  test("una exención se aplica y deja ver a cuántos habría excluido", async () => {
    const { svc, supresiones } = armar({ candidatos: zoologico() });
    await supresiones.registrar({
      telefono: telefonoDe(4),
      origen: "palabra_clave",
      detalle: "BAJA",
    });

    const a = await svc.calcularAlcance({ ...ALCANCE, incluirEnNegociacion: true });

    const negociando = a.exclusiones.find((e) => e.motivo === "en_negociacion");
    expect(negociando).toEqual({
      motivo: "en_negociacion",
      cantidad: 1,
      aplicada: false,
      eximible: true,
    });
    expect(a.destinatarios).toBe(3);
  });

  test("la muestra sale enmascarada, en el orden de salida y paginada", async () => {
    const { svc, supresiones } = armar({ candidatos: zoologico() });
    await supresiones.registrar({
      telefono: telefonoDe(4),
      origen: "palabra_clave",
      detalle: "BAJA",
    });

    const a = await svc.calcularAlcance(ALCANCE);
    expect(a.muestra.map((d) => d.leadId)).toEqual([leadIdDe(1), leadIdDe(2)]);
    expect(a.muestra[0]).toEqual({
      leadId: leadIdDe(1),
      nombre: "Lead 1",
      telefono: "+593 ••• ••• 001",
      vehiculo: "Chevrolet Aveo 2012",
      ruta: "ventana_abierta",
      // Sin texto libre en el pedido: también con la ventana abierta, la plantilla.
      contenido: "plantilla",
      tanda: 0,
      diff: null,
    });

    const segunda = await svc.calcularAlcance({ ...ALCANCE, muestra: { desde: 1, limite: 1 } });
    expect(segunda.muestra.map((d) => d.leadId)).toEqual([leadIdDe(2)]);
    expect(segunda.muestraDesde).toBe(1);
  });

  test("el cupo sale del tope de Meta y lo usado; las tandas, del planificador", async () => {
    const candidatos = Array.from({ length: 30 }, (_, i) => candidato(i + 1));
    const { svc } = armar({ candidatos, tope: { estado: "ok", tope: 250 }, usoCupo: 200 });

    const a = await svc.calcularAlcance(ALCANCE);

    // 250 − 200 = 50 restantes, 38 de reserva: 12 plantillas por tanda.
    expect(a.cupo).toEqual({
      estado: "ok",
      tope: 250,
      usado24h: 200,
      reserva: 38,
      restante: 50,
      porTanda: 12,
      solicitado: 30,
      alcanza: true,
    });
    expect(a.tandas.map((t) => t.porPlantilla)).toEqual([12, 12, 6]);
    expect(a.tandas[0]?.desde).toBe(AHORA.toISOString());
  });

  test("sin cupo, las exclusiones se calculan igual y el cupo dice que no alcanza", async () => {
    const candidatos = Array.from({ length: 5 }, (_, i) => candidato(i + 1));
    const { svc } = armar({ candidatos, tope: { estado: "ok", tope: 250 }, usoCupo: 240 });

    const a = await svc.calcularAlcance(ALCANCE);

    expect(a.cupo).toMatchObject({ estado: "ok", porTanda: 0, alcanza: false, solicitado: 5 });
    expect(a.destinatarios).toBe(5);
    expect(a.tandas).toEqual([]);
  });

  test("si Meta no dio el tope, el cupo queda sin dato y no se inventan tandas", async () => {
    const { svc } = armar({
      candidatos: [candidato(1)],
      tope: { estado: "sin-dato", motivo: "Meta no respondió" },
    });

    const a = await svc.calcularAlcance(ALCANCE);

    expect(a.cupo).toEqual({ estado: "sin-dato", motivo: "Meta no respondió", solicitado: 1 });
    expect(a.tandas).toEqual([]);
    expect(a.destinatarios).toBe(1);
  });

  test("sin plantilla elegida se calcula como marketing y lo dice", async () => {
    const { svc } = armar({ candidatos: [candidato(1)] });
    const a = await svc.calcularAlcance({ ...ALCANCE, plantillaCategoria: null });
    expect(a.categoriaSupuesta).toBe(true);
    expect(a.porRuta.plantilla).toBe(1);
  });

  test("compara contra la difusión anterior: nuevos, repiten y ya no califican", async () => {
    const { svc, difusiones, programacion } = armar({
      candidatos: [candidato(2), candidato(3), candidato(4)],
    });
    const previa = await difusiones.create({
      nombre: "Promo agosto",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });
    await programacion.programar({
      difusionId: previa.id,
      programadaPara: AHORA,
      canaryTamano: null,
      filas: [filaEnCola(previa.id, 1), filaEnCola(previa.id, 2), filaEnCola(previa.id, 3)],
    });

    const a = await svc.calcularAlcance({ ...ALCANCE, conDiff: true });

    expect(a.diff).toEqual({
      referencia: { id: previa.id, nombre: "Promo agosto" },
      nuevos: 1,
      repiten: 2,
      yaNoCalifican: 1,
    });
    expect(a.muestra.find((d) => d.leadId === leadIdDe(4))?.diff).toBe("nuevo");
    expect(a.muestra.find((d) => d.leadId === leadIdDe(2))?.diff).toBe("repite");
  });

  test("sin envío anterior no hay con qué comparar", async () => {
    const { svc } = armar({ candidatos: [candidato(1)] });
    const a = await svc.calcularAlcance({ ...ALCANCE, conDiff: true });
    expect(a.diff).toBeNull();
  });
});

describe("DifusionService — programar", () => {
  test("persiste el plan, pasa a programada y avisa al motor", async () => {
    const { svc, difusiones, envios, programacion, avisarProgramada, supresiones } = armar({
      candidatos: zoologico(),
    });
    await supresiones.registrar({
      telefono: telefonoDe(4),
      origen: "palabra_clave",
      detalle: "BAJA",
    });
    const d = await borradorConPlantilla(svc);

    const r = await svc.programar(d.id, { canaryTamano: null });

    expect(r).toEqual({
      difusionId: d.id,
      audienciaInicial: 9,
      destinatarios: 2,
      tandas: 1,
      yaEstabaProgramada: false,
    });
    expect((await difusiones.findById(d.id))?.estado).toBe("programada");
    const conteo = await envios.contarPorDifusion(d.id);
    expect(conteo.total).toBe(9);
    expect(conteo.porMotivo.baja_propia).toBe(1);
    expect(programacion.avisos).toHaveLength(1);
    expect(avisarProgramada).toHaveBeenCalledWith({
      name: "difusion/programada",
      id: `difusion-programada:${d.id}`,
      data: {
        difusionId: d.id,
        programadaPara: AHORA.toISOString(),
        audienciaInicial: 9,
        destinatarios: 2,
      },
    });
  });

  // Falla cerrado: una lista de bajas que no se puede consultar no puede
  // responder "nadie se dio de baja". Sin las claves HMAC no se planifica, no
  // se escribe ningún envío y no se avisa al motor.
  test("sin claves para revisar las bajas no se programa ni se manda nada", async () => {
    const sinClaves = new InMemoryDifusionSupresionesRepository({
      hasher: () => hasherBajasDesde({}),
    });
    const { svc, difusiones, envios, avisarProgramada } = armar({
      candidatos: zoologico(),
      supresiones: sinClaves,
    });
    const d = await borradorConPlantilla(svc);

    await expect(svc.programar(d.id, { canaryTamano: null })).rejects.toThrow(IllegalStateError);
    await expect(svc.calcularAlcance(ALCANCE)).rejects.toThrow(IllegalStateError);

    expect((await difusiones.findById(d.id))?.estado).toBe("borrador");
    expect((await envios.contarPorDifusion(d.id)).total).toBe(0);
    expect(avisarProgramada).not.toHaveBeenCalled();
  });

  test("sin plantilla no se programa ni se escribe nada", async () => {
    const { svc, envios } = armar({ candidatos: [candidato(1)] });
    const d = await svc.crearBorrador(
      {
        nombre: "Sin plantilla",
        audiencia: ARBOL,
        todaLaBase: false,
        modo: "congelada",
        incluirEnNegociacion: false,
        exentaTopeFrecuencia: false,
      },
      ADMIN,
    );

    await expect(svc.programar(d.id, { canaryTamano: null })).rejects.toThrow(ValidationError);
    expect((await envios.contarPorDifusion(d.id)).total).toBe(0);
  });

  test("un árbol vacío sin elegir toda la base no se programa", async () => {
    const { svc } = armar({ candidatos: [candidato(1)] });
    const d = await borradorConPlantilla(svc, { audiencia: VACIO });
    await expect(svc.programar(d.id, { canaryTamano: null })).rejects.toThrow(ValidationError);
  });

  test("sin el tope de Meta no se programa: no se sabe cuántos entran por día", async () => {
    const { svc } = armar({
      candidatos: [candidato(1)],
      tope: { estado: "sin-dato", motivo: "token vencido" },
    });
    const d = await borradorConPlantilla(svc);
    await expect(svc.programar(d.id, { canaryTamano: null })).rejects.toThrow(ValidationError);
  });

  test("sin cupo para plantillas no se programa ni se escribe nada", async () => {
    const { svc, difusiones, envios } = armar({ candidatos: [candidato(1)], usoCupo: 240 });
    const d = await borradorConPlantilla(svc);

    await expect(svc.programar(d.id, { canaryTamano: null })).rejects.toThrow(BudgetExceededError);
    expect((await difusiones.findById(d.id))?.estado).toBe("borrador");
    expect((await envios.contarPorDifusion(d.id)).total).toBe(0);
  });

  test("programar dos veces no reescribe el plan: vuelve a avisar con el mismo id", async () => {
    const { svc, envios, avisarProgramada } = armar({ candidatos: [candidato(1), candidato(2)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: null });

    const r = await svc.programar(d.id, { canaryTamano: null });

    expect(r.yaEstabaProgramada).toBe(true);
    expect(r.destinatarios).toBe(2);
    expect((await envios.contarPorDifusion(d.id)).total).toBe(2);
    expect(avisarProgramada).toHaveBeenCalledTimes(2);
    expect(avisarProgramada.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      expect.objectContaining({ id: `difusion-programada:${d.id}` }),
      expect.objectContaining({ id: `difusion-programada:${d.id}` }),
    ]);
  });

  test("si el aviso directo falla, la difusión queda programada y se registra el aviso", async () => {
    const warn = vi.fn();
    const logger: Logger = Object.assign(new NoopLogger(), { warn });
    const { svc, difusiones, avisarProgramada } = armar({ candidatos: [candidato(1)], logger });
    avisarProgramada.mockRejectedValueOnce(new Error("inngest caído"));
    const d = await borradorConPlantilla(svc);

    await expect(svc.programar(d.id, { canaryTamano: null })).resolves.toMatchObject({
      destinatarios: 1,
    });
    expect((await difusiones.findById(d.id))?.estado).toBe("programada");
    expect(warn).toHaveBeenCalledWith(
      "difusion.aviso_directo_fallido",
      expect.objectContaining({ difusionId: d.id }),
    );
  });

  test("un canary que no es menor que los destinatarios se rechaza", async () => {
    const { svc } = armar({ candidatos: [candidato(1), candidato(2)] });
    const d = await borradorConPlantilla(svc);
    await expect(svc.programar(d.id, { canaryTamano: 2 })).rejects.toThrow(ValidationError);
  });

  test("con un canary válido lo guarda", async () => {
    const { svc, difusiones } = armar({ candidatos: [candidato(1), candidato(2), candidato(3)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: 1 });
    expect((await difusiones.findById(d.id))?.canary_tamano).toBe(1);
  });

  test("si todos quedan excluidos no hay a quién mandarle", async () => {
    const { svc } = armar({
      candidatos: [candidato(1, { etapaActiva: "requiere_humano" })],
    });
    const d = await borradorConPlantilla(svc);
    await expect(svc.programar(d.id, { canaryTamano: null })).rejects.toThrow(ValidationError);
  });

  test("una detenida no se vuelve a programar", async () => {
    const { svc } = armar({ candidatos: [candidato(1)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: null });
    await svc.cancelar(d.id, { motivo: "Detenida a mano", actorId: ADMIN });

    await expect(svc.programar(d.id, { canaryTamano: null })).rejects.toThrow(ConflictError);
  });
});

describe("DifusionService — pausar, reanudar y detener", () => {
  test("detener frena lo pendiente, deja constancia y dice qué ya salió", async () => {
    const { svc, difusiones, envios } = armar({ candidatos: [candidato(1), candidato(2)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: null });
    const [primero] = await envios.listarPorDifusion(d.id, { limite: 10 });
    await envios.marcarAceptado(primero!.id, "wamid.servicio.1");

    const r = await svc.cancelar(d.id, { motivo: "  La promo terminó  ", actorId: ADMIN });

    expect(r).toEqual({ cancelados: 1, yaSalieron: 1 });
    const leida = await difusiones.findById(d.id);
    expect(leida).toMatchObject({
      estado: "detenida",
      motivo_detencion: "La promo terminó",
      detenida_por: ADMIN,
    });
    expect(leida?.finalizada_at?.toISOString()).toBe(AHORA.toISOString());
  });

  test("detener dos veces no falla y no cambia el motivo", async () => {
    const { svc, difusiones } = armar({ candidatos: [candidato(1)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: null });
    await svc.cancelar(d.id, { motivo: "Primera", actorId: ADMIN });

    await expect(svc.cancelar(d.id, { motivo: "Segunda", actorId: ADMIN })).resolves.toEqual({
      cancelados: 0,
      yaSalieron: 0,
    });
    expect((await difusiones.findById(d.id))?.motivo_detencion).toBe("Primera");
  });

  test("un borrador no se detiene, y detener sin motivo se rechaza", async () => {
    const { svc } = armar();
    const d = await borradorConPlantilla(svc);
    await expect(svc.cancelar(d.id, { motivo: "x", actorId: ADMIN })).rejects.toThrow(
      ConflictError,
    );
    await expect(svc.cancelar(d.id, { motivo: "   ", actorId: ADMIN })).rejects.toThrow(
      ValidationError,
    );
  });

  test("pausar sólo desde enviando, y reanudar vuelve a enviando", async () => {
    const { svc, difusiones } = armar({ candidatos: [candidato(1)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: null });

    await expect(svc.pausar(d.id)).rejects.toThrow(ConflictError);

    // Lo que haría el motor al arrancar.
    await difusiones.update(d.id, { estado: "enviando", iniciada_at: AHORA });
    expect((await svc.pausar(d.id)).estado).toBe("en_revision");
    expect((await svc.reanudar(d.id)).estado).toBe("enviando");
    await expect(svc.reanudar(d.id)).rejects.toThrow(ConflictError);
  });

  test("reanudar saca el motivo de revisión del sistema y avisa al motor", async () => {
    const { svc, difusiones, avisarReanudada } = armar({ candidatos: [candidato(1)] });
    const d = await borradorConPlantilla(svc);
    await svc.programar(d.id, { canaryTamano: null });
    await difusiones.update(d.id, { estado: "enviando", iniciada_at: AHORA });
    await difusiones.update(d.id, {
      estado: "en_revision",
      motivo_revision: "Meta pausó la plantilla (132015)",
    });

    const r = await svc.reanudar(d.id);

    expect(r.motivo_revision).toBeNull();
    expect(avisarReanudada).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "difusion/reanudada",
        data: { difusionId: d.id, reanudadaAt: AHORA.toISOString() },
      }),
    );
  });
});

describe("DifusionService — valores de las variables", () => {
  test("devuelve por lead los datos que resuelven las variables, sin los que no tiene", async () => {
    const { svc } = armar({
      datosDelLead: async (id) =>
        id === leadIdDe(1)
          ? { lead: { nombre: "Ana", vehiculo_modelo: "Aveo", vehiculo_marca: null } }
          : { lead: { nombre: "" }, sesion: { consulta: "radiador" } },
    });

    const v = await svc.valoresDeVariables([leadIdDe(1), leadIdDe(2)]);

    expect(v).toEqual({
      [leadIdDe(1)]: { nombre: "Ana", vehiculo_modelo: "Aveo" },
      [leadIdDe(2)]: { consulta: "radiador" },
    });
  });

  test("sin la fuente de datos no afirma nada", async () => {
    const { svc } = armar();
    expect(await svc.valoresDeVariables([leadIdDe(1)])).toEqual({});
  });
});

describe("DifusionService — lecturas", () => {
  test("el listado trae métricas por difusión, las bajas y los destinatarios de 30 días", async () => {
    const { svc, difusiones, programacion, supresiones } = armar();
    const uno = await difusiones.create({
      nombre: "Uno",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });
    await programacion.programar({
      difusionId: uno.id,
      programadaPara: AHORA,
      canaryTamano: null,
      filas: [filaEnCola(uno.id, 1), filaEnCola(uno.id, 2), filaExcluida(uno.id, 3)],
    });
    const dos = await difusiones.create({
      nombre: "Dos",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });
    await supresiones.registrar({ telefono: telefonoDe(50), origen: "manual" });

    const l = await svc.listar();

    expect(l.difusiones.map((x) => x.nombre)).toEqual(["Dos", "Uno"]);
    expect(l.difusiones.find((x) => x.id === uno.id)).toMatchObject({
      estado: "programada",
      plantilla: "promo_frenos_v3",
      destinatarios: 2,
      entregados: 0,
      leidos: 0,
      fallidos: 0,
      enCola: 2,
    });
    expect(l.difusiones.find((x) => x.id === dos.id)).toMatchObject({
      estado: "borrador",
      destinatarios: 0,
    });
    expect(l.suprimidos).toBe(1);
    expect(l.destinatarios30d).toBe(2);
    expect(l.destinatarios30dCompleto).toBe(true);
    expect(l.hayMas).toBe(false);
  });

  test("el listado dice cuando hay más difusiones de las que muestra", async () => {
    const { svc, difusiones } = armar();
    for (let i = 0; i <= LIMITE_LISTADO; i++) {
      await difusiones.create({
        nombre: `Difusión ${i}`,
        audiencia: ARBOL,
        creada_por: null,
        ...CON_PLANTILLA,
      });
    }

    const l = await svc.listar();

    expect(l.difusiones).toHaveLength(LIMITE_LISTADO);
    expect(l.hayMas).toBe(true);
  });

  test("el detalle trae el conteo, el plan por tanda y los fallidos", async () => {
    const { svc, difusiones, programacion } = armar();
    const uno = await difusiones.create({
      nombre: "Uno",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });
    await programacion.programar({
      difusionId: uno.id,
      programadaPara: AHORA,
      canaryTamano: null,
      filas: [filaEnCola(uno.id, 1), filaEnCola(uno.id, 2), filaExcluida(uno.id, 3)],
    });

    const det = await svc.detalle(uno.id);

    expect(det?.difusion).toMatchObject({ id: uno.id, nombre: "Uno", estado: "programada" });
    expect(det?.conteo.total).toBe(3);
    expect(det?.conteo.porEstado.en_cola).toBe(2);
    expect(det?.conteo.porMotivo.baja_propia).toBe(1);
    expect(det?.tandas).toEqual([
      { tanda: 0, desde: AHORA.toISOString(), total: 2, enCola: 2, porPlantilla: 2 },
    ]);
    expect(det?.fallos).toEqual([]);
    expect(await svc.detalle("00000000-0000-4000-8000-000000000999")).toBeNull();
  });

  test("los catálogos son etiquetas, vendedores activos y difusiones que ya salieron", async () => {
    const { svc, difusiones, programacion, tags, usuarios } = armar();
    const tag = await tags.create({ nombre: "Pide factura", color: "#f59e0b", descripcion: null });
    await usuarios.create({
      nombre: "Vendedora",
      email: "v@crm.local",
      rol: "vendedor",
      activo: true,
    });
    await usuarios.create({
      nombre: "De baja",
      email: "b@crm.local",
      rol: "vendedor",
      activo: false,
    });
    const uno = await difusiones.create({
      nombre: "Uno",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });
    await programacion.programar({
      difusionId: uno.id,
      programadaPara: AHORA,
      canaryTamano: null,
      filas: [filaEnCola(uno.id, 1)],
    });
    await difusiones.create({
      nombre: "Borrador",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });

    const c = await svc.catalogosAudiencia();

    expect(c.etiquetas).toEqual([{ valor: tag.id, etiqueta: "Pide factura", color: "#f59e0b" }]);
    expect(c.vendedores.map((v) => v.etiqueta)).toEqual(["Vendedora"]);
    expect(c.campanias).toEqual([{ valor: uno.id, etiqueta: "Uno" }]);
  });

  test("el estado del cupo, sin difusión en armado", async () => {
    const { svc } = armar({ tope: { estado: "ok", tope: 2000 }, usoCupo: 1150 });
    expect(await svc.estadoCupo()).toEqual({
      estado: "ok",
      tope: 2000,
      usado24h: 1150,
      reserva: 300,
      restante: 850,
      porTanda: 550,
      solicitado: 0,
      alcanza: true,
    });
  });
});

describe("DifusionService — el envío en curso: respuestas, ritmo y muestra", () => {
  async function conPlan(
    canaryTamano: number | null = null,
    leerRespuestas?: DifusionServiceDeps["leerRespuestas"],
  ) {
    const m = armar({ candidatos: [candidato(1), candidato(2), candidato(3)], leerRespuestas });
    const d = await borradorConPlantilla(m.svc);
    await m.svc.programar(d.id, { canaryTamano });
    await m.difusiones.update(d.id, { estado: "enviando", iniciada_at: AHORA });
    const filas = await m.envios.listarPorDifusion(d.id, { limite: 10 });
    return { ...m, d, filas };
  }

  async function salio(
    m: Awaited<ReturnType<typeof conPlan>>,
    i: number,
    wamid: string,
    at = AHORA,
  ) {
    const fila = m.filas[i]!;
    await m.envios.reservar(fila.id, at);
    await m.envios.marcarAceptado(fila.id, wamid);
    return fila;
  }

  test("trae cuántos respondieron y las respuestas, con el nombre y el texto", async () => {
    let leadRespondio = "";
    const leer = vi.fn(async () => ({
      textos: new Map([["wamid.in-1", { contenido: "¿tenés pastillas?", tipo: "text" }]]),
      nombres: new Map([[leadRespondio, "Marcela"]]),
    }));
    const m = await conPlan(null, leer);
    const f0 = await salio(m, 0, "wamid.a");
    leadRespondio = f0.lead_id!;
    await salio(m, 1, "wamid.b");
    await m.envios.marcarRespondido(f0.id, "wamid.in-1", AHORA);

    const det = await m.svc.detalle(m.d.id);

    expect(det?.respuestas.total).toBe(1);
    expect(det?.respuestas.recientes).toEqual([
      {
        leadId: f0.lead_id,
        nombre: "Marcela",
        texto: "¿tenés pastillas?",
        tipo: "text",
        respondidoAt: AHORA.toISOString(),
      },
    ]);
    expect(leer).toHaveBeenCalledWith(["wamid.in-1"], [f0.lead_id]);
  });

  test("mide el ritmo con lo que se reservó en la ventana reciente", async () => {
    const m = await conPlan();
    await salio(m, 0, "wamid.a", hace(MINUTO));
    await salio(m, 1, "wamid.b", hace(HORA));

    const det = await m.svc.detalle(m.d.id);

    expect(det?.avance).toEqual({
      reservadosEnVentana: 1,
      ventanaMs: 5 * MINUTO,
      calculadoAt: AHORA.toISOString(),
    });
  });

  test("con muestra revisada trae cuándo salió, qué pasó en ella y cuándo se siguió", async () => {
    const m = await conPlan(2);
    await salio(m, 0, "wamid.a", hace(10 * MINUTO));
    const f1 = await salio(m, 1, "wamid.b", hace(10 * MINUTO));
    await m.envios.aplicarEstadoMeta("wamid.a", "entregado");
    await m.envios.aplicarEstadoMeta("wamid.b", "fallido", { codigo: "131050", detalle: null });
    await m.difusiones.update(m.d.id, {
      estado: "en_revision",
      motivo_revision: "Salió la muestra",
      canary_revisado_at: hace(9 * MINUTO),
    });
    void f1;

    await m.svc.reanudar(m.d.id);
    const det = await m.svc.detalle(m.d.id);

    expect(det?.muestra).toMatchObject({
      tamano: 2,
      salioAt: hace(9 * MINUTO).toISOString(),
      continuadaAt: AHORA.toISOString(),
    });
    expect(det?.muestra?.conteo).toEqual(
      expect.arrayContaining([
        { estado: "entregado", codigo: null, cantidad: 1 },
        { estado: "fallido", codigo: "131050", cantidad: 1 },
      ]),
    );
  });

  test("sin muestra no hay bloque de muestra", async () => {
    const m = await conPlan();
    expect((await m.svc.detalle(m.d.id))?.muestra).toBeNull();
  });
});

describe("DifusionService — eximir una exclusión queda en la auditoría", () => {
  test("destildar «en negociación» o «tope de frecuencia» deja una fila por cada una, con quién", async () => {
    const { svc, audit } = armar();
    const d = await svc.crearBorrador(
      {
        nombre: "Promo",
        audiencia: ARBOL,
        todaLaBase: false,
        modo: "congelada",
        incluirEnNegociacion: false,
        exentaTopeFrecuencia: false,
      },
      ADMIN,
    );

    await svc.guardarBorrador(d.id, { incluirEnNegociacion: true }, ADMIN);
    await svc.guardarBorrador(
      d.id,
      { incluirEnNegociacion: true, exentaTopeFrecuencia: true },
      ADMIN,
    );

    const filas = await audit.list({ entityId: d.id });
    expect(filas.map((f) => [f.action, f.payload.motivo, f.actor_user_id]).sort()).toEqual([
      ["difusion.exclusion_eximida", "cap_frecuencia", ADMIN],
      ["difusion.exclusion_eximida", "en_negociacion", ADMIN],
    ]);
  });

  test("volver a excluir también queda, y no tocarla no deja nada", async () => {
    const { svc, audit } = armar();
    const d = await svc.crearBorrador(
      {
        nombre: "Promo",
        audiencia: ARBOL,
        todaLaBase: false,
        modo: "congelada",
        incluirEnNegociacion: true,
        exentaTopeFrecuencia: false,
      },
      ADMIN,
    );
    await svc.guardarBorrador(d.id, { nombre: "Otra" }, ADMIN);
    await svc.guardarBorrador(d.id, { incluirEnNegociacion: false }, ADMIN);

    const acciones = (await audit.list({ entityId: d.id })).map((f) => f.action).sort();
    // Crear el borrador ya eximido cuenta como eximir.
    expect(acciones).toEqual(["difusion.exclusion_eximida", "difusion.exclusion_restituida"]);
  });
});

describe("DifusionService — texto libre (§7.3.5)", () => {
  test("guarda el texto libre del borrador, recortado, y null lo saca", async () => {
    const { svc } = armar();
    const d = await borradorConPlantilla(svc);

    const con = await svc.guardarBorrador(d.id, { textoLibre: "  Hola {{lead.nombre}}  " }, ADMIN);
    expect(con.texto_libre).toBe("Hola {{lead.nombre}}");

    const sin = await svc.guardarBorrador(d.id, { textoLibre: null }, ADMIN);
    expect(sin.texto_libre).toBeNull();
  });

  test("un texto libre con una variable que el motor no carga se rechaza", async () => {
    const { svc } = armar();
    const d = await borradorConPlantilla(svc);
    await expect(
      svc.guardarBorrador(d.id, { textoLibre: "Hola {{vendedor.nombre}}" }, ADMIN),
    ).rejects.toThrow(ValidationError);
  });

  test("el alcance marca quiénes van por texto libre y quiénes por plantilla", async () => {
    const { svc } = armar({
      candidatos: [candidato(1, { ultimoEntranteAt: hace(2 * HORA) }), candidato(2)],
    });

    const con = await svc.calcularAlcance({ ...ALCANCE, textoLibre: true });
    expect(con.porContenido).toEqual({ texto_libre: 1, plantilla: 1 });
    expect(con.muestra.find((m) => m.leadId === leadIdDe(1))?.contenido).toBe("texto_libre");

    const sin = await svc.calcularAlcance(ALCANCE);
    expect(sin.porContenido).toEqual({ texto_libre: 0, plantilla: 2 });
  });

  test("la vista del borrador trae el texto libre", async () => {
    const { svc } = armar();
    const d = await borradorConPlantilla(svc);
    await svc.guardarBorrador(d.id, { textoLibre: "Hola" }, ADMIN);
    expect((await svc.detalle(d.id))?.difusion.textoLibre).toBe("Hola");
  });
});

describe("DifusionService — audiencia dinámica en el detalle", () => {
  test("el detalle dice cuántos entraron después de programar", async () => {
    const { svc, difusiones, programacion, envios } = armar();
    const uno = await difusiones.create({
      nombre: "Dinámica",
      audiencia: ARBOL,
      creada_por: null,
      audiencia_modo: "dinamica",
      ...CON_PLANTILLA,
    });
    await programacion.programar({
      difusionId: uno.id,
      programadaPara: AHORA,
      canaryTamano: null,
      filas: [filaEnCola(uno.id, 1)],
    });
    await envios.sumarAltas([filaEnCola(uno.id, 2), filaEnCola(uno.id, 3)]);

    const det = await svc.detalle(uno.id);

    expect(det?.altasDinamicas).toBe(2);
    expect(det?.difusion.audienciaModo).toBe("dinamica");
  });
});
