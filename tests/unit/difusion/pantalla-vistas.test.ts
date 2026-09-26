import { describe, expect, it } from "vitest";
import { vistaAlcance } from "@/app/(panel)/difusion/_lib/alcance";
import {
  filasDelListado,
  plantillasParaDifusion,
  saludDelNumero,
  vistaEnvio,
} from "@/app/(panel)/difusion/_lib/vistas";
import { MOTIVO_EXCLUSION, esMotivoEximible, type MotivoExclusion } from "@/lib/difusion/modelo";
import { fechaLegibleEnZona } from "@/lib/zona-horaria";
import type {
  Alcance,
  DetalleDifusion,
  DifusionResumen,
} from "@/server/services/difusion/difusion.service";
import type { PlantillaLeida, SaludWhatsApp } from "@/server/services/meta/salud-whatsapp.service";

const TZ = "America/Guayaquil";
const fecha = (iso: string) => fechaLegibleEnZona(TZ, new Date(iso));

function plantilla(
  parcial: Partial<PlantillaLeida> & Pick<PlantillaLeida, "id" | "nombre">,
): PlantillaLeida {
  return {
    idioma: "es",
    categoria: "MARKETING",
    estado: "APPROVED",
    motivoRechazo: null,
    calidad: null,
    encabezado: null,
    cuerpo: null,
    pie: null,
    respuestasRapidas: [],
    ...parcial,
  };
}

function salud(parcial: Partial<SaludWhatsApp> = {}): SaludWhatsApp {
  return {
    consultadoAt: new Date("2026-09-14T13:40:00.000Z"),
    versionApi: "v21.0",
    estadoDeEnvio: { estado: "ok", valor: { puedeEnviar: "AVAILABLE", entidades: [] } },
    limite: { estado: "ok", valor: { crudo: "TIER_2000", destinatarios: 2000 } },
    numeros: {
      estado: "ok",
      valor: {
        numeros: [
          {
            id: "otro",
            numero: "+1 555 000 0000",
            nombreVerificado: null,
            calidad: "RED",
            esElConfigurado: false,
          },
          {
            id: "n1",
            numero: "+1 555 000 0001",
            nombreVerificado: null,
            calidad: "GREEN",
            esElConfigurado: true,
          },
        ],
        hayMas: false,
        motivoParcial: null,
      },
    },
    plantillas: {
      estado: "ok",
      valor: {
        plantillas: [
          plantilla({ id: "t3", nombre: "codigo_acceso", categoria: "AUTHENTICATION" }),
          plantilla({
            id: "t2",
            nombre: "seguimiento_cotizacion",
            categoria: "UTILITY",
            estado: "PAUSED",
          }),
          plantilla({
            id: "t2en",
            nombre: "seguimiento_cotizacion",
            idioma: "en",
            categoria: "UTILITY",
            estado: "PAUSED",
          }),
          plantilla({ id: "t1", nombre: "promo_frenos" }),
          plantilla({ id: "t4", nombre: "archivada", estado: "ARCHIVED" }),
        ],
        hayMas: false,
        limite: 100,
      },
    },
    ...parcial,
  };
}

describe("saludDelNumero", () => {
  it("toma la calidad del número por el que manda el CRM, no la de otro de la cuenta", () => {
    expect(saludDelNumero(salud(), TZ).calidad).toEqual({
      estado: "ok",
      valor: { calidad: "alta", cruda: "GREEN" },
    });
  });

  it("si Meta no devolvió el número configurado, la calidad queda sin dato", () => {
    const sinConfigurado = salud({
      numeros: {
        estado: "ok",
        valor: {
          numeros: [
            {
              id: "otro",
              numero: null,
              nombreVerificado: null,
              calidad: "GREEN",
              esElConfigurado: false,
            },
          ],
          hayMas: false,
          motivoParcial: null,
        },
      },
    });
    expect(saludDelNumero(sinConfigurado, TZ).calidad.estado).toBe("sin-dato");
  });

  it("si no se pudieron leer los números, la calidad queda sin dato con el motivo de la lectura", () => {
    const s = saludDelNumero(
      salud({ numeros: { estado: "error", mensaje: "timeout de Meta" } }),
      TZ,
    );
    expect(s.calidad).toEqual({
      estado: "sin-dato",
      motivo: expect.stringContaining("timeout de Meta"),
    });
  });

  it("el escalón sale del límite de mensajería de Meta", () => {
    expect(saludDelNumero(salud(), TZ).escalon).toEqual({ estado: "ok", valor: 2000 });
  });

  it("un escalón que Meta informa sin número queda sin dato: nunca se adivina", () => {
    const s = saludDelNumero(
      salud({ limite: { estado: "ok", valor: { crudo: "TIER_NOT_SET", destinatarios: null } } }),
      TZ,
    );
    expect(s.escalon.estado).toBe("sin-dato");
  });

  it("el estado de envío es el agregado de health_status", () => {
    const s = saludDelNumero(
      salud({
        estadoDeEnvio: {
          estado: "ok",
          valor: {
            puedeEnviar: "BLOCKED",
            entidades: [
              {
                tipo: "WABA",
                id: "w1",
                puedeEnviar: "BLOCKED",
                errores: [{ codigo: 1, descripcion: "Cuenta restringida", solucion: null }],
                infoAdicional: [],
              },
            ],
          },
        },
      }),
      TZ,
    );
    expect(s.envio).toEqual({ estado: "bloqueado", detalle: "Cuenta restringida" });
  });

  it("lista las plantillas pausadas por nombre, una vez aunque estén en dos idiomas", () => {
    expect(saludDelNumero(salud(), TZ).plantillasPausadas).toEqual({
      estado: "ok",
      valor: [{ nombre: "seguimiento_cotizacion", laUsaEstaDifusion: false }],
    });
  });

  it("si no se pudo leer la lista de plantillas, las pausadas quedan sin dato: no se afirma que no hay", () => {
    const s = saludDelNumero(salud({ plantillas: { estado: "error", mensaje: "403" } }), TZ);
    expect(s.plantillasPausadas.estado).toBe("sin-dato");
  });

  it("dice de dónde y cuándo se leyó", () => {
    expect(saludDelNumero(salud(), TZ).fuente).toContain("v21.0");
  });
});

describe("plantillasParaDifusion", () => {
  it("ofrece sólo marketing y utility, ordenadas por nombre, y cuenta las de otra categoría", () => {
    const r = plantillasParaDifusion(salud());
    if (r.estado !== "ok") throw new Error("se esperaba la lista");
    expect(r.valor.plantillas.map((p) => p.id)).toEqual(["t4", "t1", "t2en", "t2"]);
    expect(r.valor.ocultas).toBe(1);
    expect(r.valor.nota).toBeNull();
  });

  it("trae el texto de la plantilla que leyó de Meta, con sus variables", () => {
    const base = salud();
    if (base.plantillas.estado !== "ok") throw new Error("fixture");
    const r = plantillasParaDifusion(
      salud({
        plantillas: {
          estado: "ok",
          valor: {
            ...base.plantillas.valor,
            plantillas: [
              plantilla({
                id: "t9",
                nombre: "promo_frenos_v3",
                encabezado: "Frenos",
                cuerpo: "Hola {{1}}, tenemos pastillas para tu {{2}}.",
                pie: "Respondé BAJA",
                respuestasRapidas: ["Me interesa", "No, gracias"],
              }),
            ],
          },
        },
      }),
    );
    if (r.estado !== "ok") throw new Error("se esperaba la lista");
    expect(r.valor.plantillas[0]).toMatchObject({
      encabezado: "Frenos",
      cuerpo: "Hola {{1}}, tenemos pastillas para tu {{2}}.",
      pie: "Respondé BAJA",
      // Las acciones por botón no están construidas: no se ofrecen.
      botones: [],
    });
  });

  it("traduce categoría y estado; sin texto leído, el cuerpo queda en null", () => {
    const r = plantillasParaDifusion(salud());
    if (r.estado !== "ok") throw new Error("se esperaba la lista");
    const porId = new Map(r.valor.plantillas.map((p) => [p.id, p]));
    expect(porId.get("t1")).toMatchObject({
      nombre: "promo_frenos",
      idioma: "es",
      categoria: "marketing",
      estado: "aprobada",
      encabezado: null,
      cuerpo: null,
      pie: null,
      botones: [],
      requiereDespausadoManual: false,
      escalonPausado: null,
    });
    expect(porId.get("t2")).toMatchObject({ categoria: "utility", estado: "pausada" });
    expect(porId.get("t4")?.estado).toBe("otro");
    expect(porId.get("t1")?.nota).toEqual(expect.any(String));
  });

  it("si Meta tiene más plantillas que las leídas, lo dice", () => {
    const base = salud();
    if (base.plantillas.estado !== "ok") throw new Error("fixture");
    const r = plantillasParaDifusion(
      salud({ plantillas: { estado: "ok", valor: { ...base.plantillas.valor, hayMas: true } } }),
    );
    if (r.estado !== "ok") throw new Error("se esperaba la lista");
    expect(r.valor.nota).toContain("100");
  });

  it("si no se pudieron leer las plantillas, lo dice con el motivo", () => {
    expect(
      plantillasParaDifusion(salud({ plantillas: { estado: "error", mensaje: "403 de Meta" } })),
    ).toEqual({
      estado: "sin-dato",
      motivo: expect.stringContaining("403 de Meta"),
    });
  });
});

describe("filasDelListado", () => {
  const RESUMEN: DifusionResumen[] = [
    {
      id: "0b4a6f7e-1a2b-4c3d-8e9f-000000000001",
      nombre: "Embragues",
      estado: "borrador",
      plantilla: null,
      destinatarios: 0,
      entregados: 0,
      leidos: 0,
      fallidos: 0,
      enCola: 0,
      creadaAt: "2026-09-14T12:00:00.000Z",
      programadaPara: null,
    },
    {
      id: "0b4a6f7e-1a2b-4c3d-8e9f-000000000002",
      nombre: "Frenos",
      estado: "enviando",
      plantilla: "promo_frenos",
      destinatarios: 100,
      entregados: 35,
      leidos: 10,
      fallidos: 3,
      enCola: 40,
      creadaAt: "2026-09-13T12:00:00.000Z",
      programadaPara: "2026-09-14T13:00:00.000Z",
    },
  ];

  it("pasa las cifras del resumen y deja en null lo que todavía no se registra", () => {
    expect(filasDelListado(RESUMEN, TZ)).toEqual([
      {
        id: RESUMEN[0]!.id,
        nombre: "Embragues",
        plantilla: null,
        estado: "borrador",
        destinatarios: 0,
        entregados: 0,
        leidos: 0,
        respondieron: null,
        costoUsd: null,
        cuando: `creada ${fecha("2026-09-14T12:00:00.000Z")}`,
      },
      {
        id: RESUMEN[1]!.id,
        nombre: "Frenos",
        plantilla: "promo_frenos",
        estado: "enviando",
        destinatarios: 100,
        entregados: 35,
        leidos: 10,
        respondieron: null,
        costoUsd: null,
        cuando: fecha("2026-09-14T13:00:00.000Z"),
      },
    ]);
  });
});

describe("vistaEnvio", () => {
  const porMotivo = Object.fromEntries(MOTIVO_EXCLUSION.map((m) => [m, 0])) as Record<
    MotivoExclusion,
    number
  >;
  porMotivo.baja_propia = 10;

  const DETALLE: DetalleDifusion = {
    difusion: {
      id: "0b4a6f7e-1a2b-4c3d-8e9f-000000000002",
      nombre: "Frenos",
      estado: "enviando",
      audiencia: { id: "raiz", clase: "grupo", operador: "y", hijos: [] },
      audienciaTodaLaBase: true,
      audienciaModo: "congelada",
      plantillaNombre: "promo_frenos",
      plantillaCategoria: "marketing",
      plantillaIdioma: "es",
      plantillaParametros: [],
      textoLibre: null,
      incluirEnNegociacion: false,
      exentaTopeFrecuencia: false,
      canaryTamano: 20,
      programadaPara: "2026-09-14T13:00:00.000Z",
      iniciadaAt: null,
      finalizadaAt: null,
      motivoDetencion: null,
      motivoRevision: null,
      detenidaPorPersona: false,
      creadaAt: "2026-09-14T12:00:00.000Z",
    },
    conteo: {
      total: 110,
      porEstado: {
        excluido: 10,
        en_cola: 40,
        aceptado: 20,
        entregado: 25,
        leido: 10,
        fallido: 3,
        cancelado: 2,
      },
      porMotivo,
    },
    tandas: [
      { tanda: 0, desde: "2026-09-14T13:00:00.000Z", total: 60, enCola: 0, porPlantilla: 50 },
      { tanda: 1, desde: "2026-09-15T13:00:00.000Z", total: 40, enCola: 40, porPlantilla: 40 },
    ],
    fallos: [
      { codigo: "131049", cantidad: 2 },
      { codigo: "999", cantidad: 1 },
    ],
    respuestas: {
      total: 3,
      recientes: [
        {
          leadId: "l1",
          nombre: "Marcela",
          texto: "¿tenés pastillas?",
          tipo: "text",
          respondidoAt: "2026-09-15T13:56:00.000Z",
        },
        {
          leadId: "l2",
          nombre: null,
          texto: null,
          tipo: null,
          respondidoAt: "2026-09-15T11:00:00.000Z",
        },
      ],
    },
    // 600 en 5 minutos = 2 por segundo.
    avance: {
      reservadosEnVentana: 600,
      ventanaMs: 300_000,
      calculadoAt: "2026-09-15T14:00:00.000Z",
    },
    muestra: {
      tamano: 20,
      salioAt: "2026-09-14T13:10:00.000Z",
      continuadaAt: "2026-09-14T13:30:00.000Z",
      conteo: [
        { estado: "entregado", codigo: null, cantidad: 15 },
        { estado: "leido", codigo: null, cantidad: 2 },
        { estado: "fallido", codigo: "131050", cantidad: 2 },
        { estado: "fallido", codigo: "131026", cantidad: 1 },
      ],
    },
    altasDinamicas: 0,
  };

  it("con la audiencia congelada no hay bloque de altas; con la dinámica, cuántas entraron", () => {
    expect(vistaEnvio(DETALLE, TZ).audienciaDinamica).toBeNull();
    const dinamica = vistaEnvio(
      {
        ...DETALLE,
        difusion: { ...DETALLE.difusion, audienciaModo: "dinamica" },
        altasDinamicas: 7,
      },
      TZ,
    );
    expect(dinamica.audienciaDinamica).toEqual({ altas: 7 });
  });

  it("dice en qué tanda va, a qué ritmo, y cuándo termina si el ritmo se sostiene", () => {
    const v = vistaEnvio(DETALLE, TZ);
    expect(v.tandaActual).toEqual({ numero: 2, de: 2 });
    expect(v.ritmo.porSegundo).toBe(2);
    // La tanda 2 arranca el 15/09 13:00, ya pasó: 40 en cola a 2/s = 20 s desde ahora.
    expect(v.ritmo.finEstimado).toBe(fecha("2026-09-15T14:00:20.000Z"));
  });

  it("sin ritmo medido no inventa el fin: dice cuándo arranca la última tanda", () => {
    const v = vistaEnvio({ ...DETALLE, avance: { ...DETALLE.avance, reservadosEnVentana: 0 } }, TZ);
    expect(v.ritmo).toEqual({
      porSegundo: null,
      finEstimado: null,
      ultimaTandaDesde: fecha("2026-09-15T13:00:00.000Z"),
    });
  });

  it("lista las respuestas con hace cuánto, y cuenta el total", () => {
    const v = vistaEnvio(DETALLE, TZ);
    expect(v.respuestas.total).toBe(3);
    expect(v.respuestas.recientes).toEqual([
      {
        clave: "l1-2026-09-15T13:56:00.000Z",
        nombre: "Marcela",
        texto: "¿tenés pastillas?",
        hace: "hace 4 min",
      },
      { clave: "l2-2026-09-15T11:00:00.000Z", nombre: null, texto: null, hace: "hace 3 h" },
    ]);
  });

  it("resume la muestra: cuándo salió, qué llegó, qué falló, bajas de Meta y cuándo se siguió", () => {
    const v = vistaEnvio(DETALLE, TZ);
    expect(v.muestra).toEqual({
      tamano: 20,
      salioA: fecha("2026-09-14T13:10:00.000Z"),
      continuadaA: fecha("2026-09-14T13:30:00.000Z"),
      llegaron: 17,
      aceptados: 0,
      fallidos: 3,
      bajasMeta: 2,
    });
  });

  it("las exclusiones por motivo, sólo las que tienen alguien", () => {
    const v = vistaEnvio(DETALLE, TZ);
    expect(v.exclusionesPorMotivo).toEqual([{ motivo: "baja_propia", cantidad: 10 }]);
  });

  it("cuenta los destinatarios sin los excluidos y separa los seis estados", () => {
    const v = vistaEnvio(DETALLE, TZ);
    expect(v.total).toBe(100);
    expect(v.excluidos).toBe(10);
    expect(v.conteo).toEqual({
      en_cola: 40,
      aceptado: 20,
      entregado: 25,
      leido: 10,
      fallido: 3,
      cancelado: 2,
    });
  });

  it("describe los fallos con la tabla de Meta y deja sin descripción los que no conoce", () => {
    const v = vistaEnvio(DETALLE, TZ);
    expect(v.fallos[0]).toMatchObject({ codigo: "131049", cantidad: 2, reintentable: false });
    expect(v.fallos[0]?.significado).toEqual(expect.any(String));
    expect(v.fallos[1]).toEqual({
      codigo: "999",
      cantidad: 1,
      significado: null,
      reintento: null,
      reintentable: null,
    });
  });

  it("formatea tandas y fechas en la hora del negocio, y pasa lo demás tal cual", () => {
    const v = vistaEnvio(DETALLE, TZ);
    expect(v.tandas).toEqual([
      {
        tanda: 0,
        desde: fecha("2026-09-14T13:00:00.000Z"),
        total: 60,
        enCola: 0,
        porPlantilla: 50,
      },
      {
        tanda: 1,
        desde: fecha("2026-09-15T13:00:00.000Z"),
        total: 40,
        enCola: 40,
        porPlantilla: 40,
      },
    ]);
    expect(v).toMatchObject({
      id: DETALLE.difusion.id,
      nombre: "Frenos",
      estado: "enviando",
      plantilla: "promo_frenos",
      canaryTamano: 20,
      programadaPara: fecha("2026-09-14T13:00:00.000Z"),
      finalizadaAt: null,
      motivoDetencion: null,
      detenidaPorPersona: false,
    });
  });

  it("una detenida trae cuándo terminó y el motivo", () => {
    const v = vistaEnvio(
      {
        ...DETALLE,
        difusion: {
          ...DETALLE.difusion,
          estado: "detenida",
          finalizadaAt: "2026-09-14T15:00:00.000Z",
          motivoDetencion: "Detenida a mano desde el panel.",
          detenidaPorPersona: true,
        },
      },
      TZ,
    );
    expect(v).toMatchObject({
      estado: "detenida",
      finalizadaAt: fecha("2026-09-14T15:00:00.000Z"),
      motivoDetencion: "Detenida a mano desde el panel.",
      detenidaPorPersona: true,
    });
  });
});

describe("vistaAlcance", () => {
  const ALCANCE: Alcance = {
    calculadoAt: "2026-09-14T13:40:00.000Z",
    audienciaInicial: 120,
    destinatarios: 90,
    porRuta: { ventana_abierta: 30, plantilla: 60 },
    porContenido: { texto_libre: 12, plantilla: 78 },
    exclusiones: MOTIVO_EXCLUSION.map((m) => ({
      motivo: m,
      cantidad: m === "baja_propia" ? 30 : 0,
      aplicada: true,
      eximible: esMotivoEximible(m),
    })),
    categoriaSupuesta: true,
    cupo: {
      estado: "ok",
      tope: 2000,
      usado24h: 10,
      reserva: 300,
      restante: 1990,
      porTanda: 1690,
      solicitado: 60,
      alcanza: true,
    },
    tandas: [
      { tanda: 0, desde: "2026-09-14T13:40:00.000Z", porPlantilla: 60, porVentanaAbierta: 30 },
    ],
    muestra: [
      {
        leadId: "0b4a6f7e-1a2b-4c3d-8e9f-00000000000a",
        nombre: "Ana",
        telefono: "+593 ••• ••• 214",
        vehiculo: null,
        ruta: "plantilla",
        contenido: "plantilla",
        tanda: 0,
        diff: null,
      },
    ],
    muestraDesde: 0,
    diff: {
      referencia: { id: "0b4a6f7e-1a2b-4c3d-8e9f-000000000001", nombre: "Agosto" },
      nuevos: 70,
      repiten: 20,
      yaNoCalifican: 5,
    },
  };

  it("pasa las cifras del backend sin recalcularlas", () => {
    const v = vistaAlcance(ALCANCE, TZ);
    expect(v.audiencia).toEqual({
      coinciden: 120,
      destinatarios: 90,
      exclusiones: ALCANCE.exclusiones,
      porVentanaAbierta: 30,
      porPlantilla: 60,
      porTextoLibre: 12,
      muestra: ALCANCE.muestra,
      categoriaSupuesta: true,
    });
    expect(v.cupo).toEqual(ALCANCE.cupo);
    expect(v.diff).toEqual(ALCANCE.diff);
  });

  it("las tandas y la hora del cálculo van en la hora del negocio", () => {
    const v = vistaAlcance(ALCANCE, TZ);
    expect(v.tandas).toEqual([
      {
        tanda: 0,
        desde: fecha("2026-09-14T13:40:00.000Z"),
        porPlantilla: 60,
        porVentanaAbierta: 30,
      },
    ]);
    expect(v.calculado).toBe(fecha("2026-09-14T13:40:00.000Z"));
  });
});
