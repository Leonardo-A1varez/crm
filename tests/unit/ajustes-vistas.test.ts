import { describe, expect, test } from "vitest";
import {
  textoFueraDeHorario,
  vistaSaltos,
  vistaEmpresa,
  vistaHorario,
  vistaSalud,
  vistaUsuarios,
} from "@/app/(panel)/ajustes/_lib/vistas";
import { fechaLegibleEnZona } from "@/lib/zona-horaria";
import type {
  NumeroLeido,
  PlantillaLeida,
  SaludWhatsApp,
} from "@/server/services/meta/salud-whatsapp.service";
import type { Horario } from "@/types/agente";
import type { Usuario } from "@/types/entities";

/** Todo lo de este archivo es fixture sintético: ningún id ni número es un activo real. */
const ZONA = "America/Argentina/Buenos_Aires";
const CONSULTADO = new Date("2026-09-13T15:40:00Z");

function numero(parcial: Partial<NumeroLeido> = {}): NumeroLeido {
  return {
    id: "101",
    numero: "+1 555 0100",
    nombreVerificado: "Repuestos Uno",
    calidad: "GREEN",
    esElConfigurado: true,
    ...parcial,
  };
}

function plantilla(parcial: Partial<PlantillaLeida> = {}): PlantillaLeida {
  return {
    id: "9",
    nombre: "plantilla_de_prueba",
    idioma: "es",
    categoria: "UTILITY",
    estado: "APPROVED",
    motivoRechazo: null,
    calidad: "GREEN",
    ...parcial,
  };
}

function salud(parcial: Partial<SaludWhatsApp> = {}): SaludWhatsApp {
  return {
    consultadoAt: CONSULTADO,
    versionApi: "v21.0",
    estadoDeEnvio: {
      estado: "ok",
      valor: {
        puedeEnviar: "AVAILABLE",
        entidades: [
          {
            tipo: "PHONE_NUMBER",
            id: "101",
            puedeEnviar: "AVAILABLE",
            errores: [],
            infoAdicional: [],
          },
          { tipo: "WABA", id: "202", puedeEnviar: "AVAILABLE", errores: [], infoAdicional: [] },
        ],
      },
    },
    limite: { estado: "ok", valor: { crudo: "TIER_2000", destinatarios: 2000 } },
    usoDelLimite: { estado: "no-expuesto", motivo: "motivo de prueba del uso" },
    numeros: { estado: "ok", valor: { numeros: [numero()], hayMas: false, motivoParcial: null } },
    plantillas: { estado: "ok", valor: { plantillas: [plantilla()], hayMas: false, limite: 100 } },
    sancion: { estado: "no-expuesto", motivo: "motivo de prueba de la sanción" },
    ...parcial,
  };
}

function conNumeros(numeros: NumeroLeido[]): Partial<SaludWhatsApp> {
  return { numeros: { estado: "ok", valor: { numeros, hayMas: false, motivoParcial: null } } };
}

function conPlantillas(plantillas: PlantillaLeida[], hayMas = false): Partial<SaludWhatsApp> {
  return { plantillas: { estado: "ok", valor: { plantillas, hayMas, limite: 100 } } };
}

describe("vistaSalud — cupo", () => {
  test("ubica el escalón leído en la escalera documentada", () => {
    const { cupo } = vistaSalud(salud(), ZONA);

    if (cupo.estado !== "ok") throw new Error(`cupo en ${cupo.estado}`);
    expect(cupo.datos.peldanos.map((p) => p.destinatariosPorDia)).toEqual([
      250,
      2000,
      10000,
      100000,
      null,
    ]);
    expect(cupo.datos.peldanos.at(-1)?.etiqueta).toBe("ilimitado");
    expect(cupo.datos.actual).toBe(1);
    expect(cupo.datos.minimoPct).toBe(50);
    expect(cupo.datos.ventanaDias).toBe(7);
    expect(cupo.datos.desbloqueo).toBeNull();
  });

  test("el uso del cupo queda sin dato, con el motivo del servicio", () => {
    const { cupo } = vistaSalud(salud(), ZONA);

    if (cupo.estado !== "ok") throw new Error(`cupo en ${cupo.estado}`);
    expect(cupo.datos.uso).toEqual({ disponible: false, motivo: "motivo de prueba del uso" });
  });

  test("en el primer peldaño subir no es automático: lista las vías de desbloqueo", () => {
    const { cupo } = vistaSalud(
      salud({ limite: { estado: "ok", valor: { crudo: "TIER_250", destinatarios: 250 } } }),
      ZONA,
    );

    if (cupo.estado !== "ok") throw new Error(`cupo en ${cupo.estado}`);
    expect(cupo.datos.actual).toBe(0);
    expect(cupo.datos.desbloqueo).toHaveLength(3);
  });

  test("un escalón que no está en la escalera no se ubica a ojo: queda no disponible", () => {
    const { cupo } = vistaSalud(
      salud({ limite: { estado: "ok", valor: { crudo: "TIER_NOT_SET", destinatarios: null } } }),
      ZONA,
    );

    expect(cupo.estado).toBe("no-disponible");
    if (cupo.estado === "no-disponible") expect(cupo.motivo).toContain("TIER_NOT_SET");
  });

  test("si el límite no se pudo leer, el cupo muestra el error", () => {
    const { cupo } = vistaSalud(
      salud({ limite: { estado: "error", mensaje: "Meta rechazó el token al leer el límite" } }),
      ZONA,
    );

    expect(cupo).toEqual({ estado: "error", mensaje: "Meta rechazó el token al leer el límite" });
  });

  test("si Meta no manda el límite, el cupo lo dice", () => {
    const { cupo } = vistaSalud(
      salud({ limite: { estado: "no-expuesto", motivo: "sin el campo" } }),
      ZONA,
    );

    expect(cupo).toEqual({ estado: "no-disponible", motivo: "sin el campo" });
  });
});

describe("vistaSalud — condición de calidad del ascenso", () => {
  function calidadCon(parcial: Partial<SaludWhatsApp>) {
    const { cupo } = vistaSalud(salud(parcial), ZONA);
    if (cupo.estado !== "ok") throw new Error(`cupo en ${cupo.estado}`);
    return cupo.datos.calidad;
  }

  test("todo en GREEN: cumplida", () => {
    expect(calidadCon({})).toEqual({ estado: "cumplida" });
  });

  test("un número en YELLOW la deja en falta y lo nombra", () => {
    const c = calidadCon(
      conNumeros([
        numero(),
        numero({ id: "102", numero: "+1 555 0101", calidad: "YELLOW", esElConfigurado: false }),
      ]),
    );

    expect(c.estado).toBe("falta");
    if (c.estado === "falta") expect(c.pendientes.join(" ")).toContain("+1 555 0101");
  });

  test("una plantilla en RED también frena: Meta pide calidad en números y plantillas", () => {
    const c = calidadCon(conPlantillas([plantilla({ nombre: "plantilla_roja", calidad: "RED" })]));

    expect(c.estado).toBe("falta");
    if (c.estado === "falta") expect(c.pendientes.join(" ")).toContain("plantilla_roja");
  });

  test("un número sin calificar deja la condición sin dato, no la da por cumplida", () => {
    expect(calidadCon(conNumeros([numero({ calidad: "NA" })])).estado).toBe("sin-dato");
  });

  test("si los números no se pudieron leer, queda sin dato con el motivo", () => {
    const c = calidadCon({
      numeros: { estado: "error", mensaje: "Meta no respondió al leer el número" },
    });

    expect(c.estado).toBe("sin-dato");
    if (c.estado === "sin-dato") expect(c.motivo).toContain("Meta no respondió al leer el número");
  });

  test("si las plantillas no se pudieron leer, no se puede dar por cumplida", () => {
    const c = calidadCon({ plantillas: { estado: "error", mensaje: "falla de prueba" } });

    expect(c.estado).toBe("sin-dato");
  });
});

describe("vistaSalud — números", () => {
  test("traduce la calidad y conserva el valor crudo de Meta", () => {
    const { numeros } = vistaSalud(
      salud(
        conNumeros([
          numero({ id: "1", calidad: "GREEN" }),
          numero({ id: "2", calidad: "YELLOW", esElConfigurado: false }),
          numero({ id: "3", calidad: "RED", esElConfigurado: false }),
          numero({ id: "4", calidad: "NA", esElConfigurado: false }),
          numero({ id: "5", calidad: null, esElConfigurado: false }),
        ]),
      ),
      ZONA,
    );

    if (numeros.estado !== "ok") throw new Error(`números en ${numeros.estado}`);
    expect(numeros.datos.numeros.map((n) => [n.calidad, n.calidadCruda])).toEqual([
      ["alta", "GREEN"],
      ["media", "YELLOW"],
      ["baja", "RED"],
      ["sin-datos", "NA"],
      ["sin-datos", null],
    ]);
  });

  test("el número configurado toma su estado de envío de health_status", () => {
    const { numeros } = vistaSalud(salud(), ZONA);

    if (numeros.estado !== "ok") throw new Error(`números en ${numeros.estado}`);
    expect(numeros.datos.numeros[0]).toMatchObject({
      id: "101",
      numero: "+1 555 0100",
      nombre: "Repuestos Uno",
      esElConfigurado: true,
      envio: { estado: "disponible" },
    });
  });

  test("un número bloqueado muestra la descripción del error de Meta", () => {
    const { numeros } = vistaSalud(
      salud({
        estadoDeEnvio: {
          estado: "ok",
          valor: {
            puedeEnviar: "BLOCKED",
            entidades: [
              {
                tipo: "PHONE_NUMBER",
                id: "101",
                puedeEnviar: "BLOCKED",
                errores: [{ codigo: 1, descripcion: "descripción de prueba", solucion: null }],
                infoAdicional: [],
              },
            ],
          },
        },
      }),
      ZONA,
    );

    if (numeros.estado !== "ok") throw new Error(`números en ${numeros.estado}`);
    expect(numeros.datos.numeros[0]?.envio).toEqual({
      estado: "bloqueado",
      detalle: "descripción de prueba",
    });
  });

  test("un número limitado muestra la información adicional de Meta", () => {
    const { numeros } = vistaSalud(
      salud({
        estadoDeEnvio: {
          estado: "ok",
          valor: {
            puedeEnviar: "LIMITED",
            entidades: [
              {
                tipo: "PHONE_NUMBER",
                id: "101",
                puedeEnviar: "LIMITED",
                errores: [],
                infoAdicional: ["info de prueba"],
              },
            ],
          },
        },
      }),
      ZONA,
    );

    if (numeros.estado !== "ok") throw new Error(`números en ${numeros.estado}`);
    expect(numeros.datos.numeros[0]?.envio).toEqual({
      estado: "limitado",
      detalle: "info de prueba",
    });
  });

  test("un número del que health_status no dice nada queda sin dato", () => {
    const { numeros } = vistaSalud(
      salud(conNumeros([numero(), numero({ id: "102", esElConfigurado: false })])),
      ZONA,
    );

    if (numeros.estado !== "ok") throw new Error(`números en ${numeros.estado}`);
    expect(numeros.datos.numeros[1]?.envio.estado).toBe("sin-dato");
  });

  test("si sólo se leyó el configurado, la nota dice por qué", () => {
    const { numeros } = vistaSalud(
      salud({
        numeros: {
          estado: "ok",
          valor: { numeros: [numero()], hayMas: false, motivoParcial: "falla de prueba" },
        },
      }),
      ZONA,
    );

    if (numeros.estado !== "ok") throw new Error(`números en ${numeros.estado}`);
    expect(numeros.datos.nota).toContain("falla de prueba");
  });

  test("si Meta tiene más números de los que devolvió, la nota lo avisa", () => {
    const { numeros } = vistaSalud(
      salud({
        numeros: {
          estado: "ok",
          valor: { numeros: [numero()], hayMas: true, motivoParcial: null },
        },
      }),
      ZONA,
    );

    if (numeros.estado !== "ok") throw new Error(`números en ${numeros.estado}`);
    expect(numeros.datos.nota).not.toBeNull();
  });

  test("si los números no se pudieron leer, la sección muestra el error", () => {
    const { numeros } = vistaSalud(
      salud({ numeros: { estado: "error", mensaje: "falla de prueba" } }),
      ZONA,
    );

    expect(numeros).toEqual({ estado: "error", mensaje: "falla de prueba" });
  });
});

describe("vistaSalud — plantillas", () => {
  function plantillaVista(p: Partial<PlantillaLeida>) {
    const { plantillas } = vistaSalud(salud(conPlantillas([plantilla(p)])), ZONA);
    if (plantillas.estado !== "ok") throw new Error(`plantillas en ${plantillas.estado}`);
    const [primera] = plantillas.datos.plantillas;
    if (!primera) throw new Error("sin plantilla");
    return primera;
  }

  test.each([
    ["APPROVED", "aprobada"],
    ["PENDING", "en-revision"],
    ["IN_APPEAL", "en-revision"],
    ["REJECTED", "rechazada"],
    ["PAUSED", "pausada"],
    ["DISABLED", "deshabilitada"],
    ["LIMIT_EXCEEDED", "otro"],
    ["ARCHIVED", "otro"],
  ] as const)("%s se muestra como %s", (crudo, estado) => {
    expect(plantillaVista({ estado: crudo }).estado).toBe(estado);
  });

  test("sin estado se muestra como otro", () => {
    expect(plantillaVista({ estado: null }).estado).toBe("otro");
  });

  test("un estado sin traducción deja el valor de Meta en la nota", () => {
    expect(plantillaVista({ estado: "LIMIT_EXCEEDED" }).nota).toContain("LIMIT_EXCEEDED");
  });

  test("una en apelación lo dice en la nota", () => {
    expect(plantillaVista({ estado: "IN_APPEAL" }).nota).toMatch(/apelación/);
  });

  test("una rechazada lleva el motivo de Meta, traducido y crudo", () => {
    const p = plantillaVista({ estado: "REJECTED", motivoRechazo: "INVALID_FORMAT" });

    expect(p.nota).toContain("INVALID_FORMAT");
    expect(p.nota).toContain("formato");
  });

  test("una pausada no promete que vuelva sola ni que haya que despausarla: la API no lo dice", () => {
    const p = plantillaVista({ estado: "PAUSED" });

    expect(p.requiereDespausadoManual).toBe(false);
    expect(p.escalonPausado).toBeNull();
    expect(p.nota).toMatch(/3 h/);
    expect(p.nota).toMatch(/pacing/);
  });

  test("categoría legible e idioma", () => {
    const p = plantillaVista({ categoria: "UTILITY", idioma: "es_AR" });

    expect(p.categoria).toBe("Utility");
    expect(p.idioma).toBe("es_AR");
    expect(plantillaVista({ categoria: null }).categoria).toBe("—");
  });

  test("si Meta tiene más plantillas que el tope, la nota lo avisa con el número", () => {
    const { plantillas } = vistaSalud(salud(conPlantillas([plantilla()], true)), ZONA);

    if (plantillas.estado !== "ok") throw new Error(`plantillas en ${plantillas.estado}`);
    expect(plantillas.datos.nota).toContain("100");
  });

  test("sin WABA, las plantillas quedan no disponibles con el motivo", () => {
    const { plantillas } = vistaSalud(
      salud({ plantillas: { estado: "no-expuesto", motivo: "sin WABA de prueba" } }),
      ZONA,
    );

    expect(plantillas).toEqual({ estado: "no-disponible", motivo: "sin WABA de prueba" });
  });
});

describe("vistaSalud — sanciones y estado de envío", () => {
  test("la posición en la escalera queda no disponible, con el motivo del servicio", () => {
    expect(vistaSalud(salud(), ZONA).posicion).toEqual({
      tipo: "no-disponible",
      motivo: "motivo de prueba de la sanción",
    });
  });

  test("la escalera es la de la política de Meta, de la advertencia a la baja", () => {
    const { escalones } = vistaSalud(salud(), ZONA);

    expect(escalones.map((e) => e.duracion)).toEqual([
      "sin bloqueo",
      "1 o 3 días",
      "5, 7 o 30 días",
      "indefinido",
      "permanente",
    ]);
  });

  test("con health_status en AVAILABLE, el envío está disponible", () => {
    expect(vistaSalud(salud(), ZONA).envio).toEqual({ estado: "disponible" });
  });

  test("bloqueado junta las descripciones de las entidades bloqueadas", () => {
    const { envio } = vistaSalud(
      salud({
        estadoDeEnvio: {
          estado: "ok",
          valor: {
            puedeEnviar: "BLOCKED",
            entidades: [
              {
                tipo: "WABA",
                id: "202",
                puedeEnviar: "BLOCKED",
                errores: [{ codigo: 1, descripcion: "primera", solucion: null }],
                infoAdicional: [],
              },
              {
                tipo: "APP",
                id: "404",
                puedeEnviar: "BLOCKED",
                errores: [{ codigo: 2, descripcion: "segunda", solucion: null }],
                infoAdicional: [],
              },
            ],
          },
        },
      }),
      ZONA,
    );

    expect(envio.estado).toBe("bloqueado");
    if (envio.estado === "bloqueado") {
      expect(envio.detalle).toContain("primera");
      expect(envio.detalle).toContain("segunda");
    }
  });

  test("si health_status no respondió, el envío queda sin dato con el motivo", () => {
    const { envio } = vistaSalud(
      salud({ estadoDeEnvio: { estado: "error", mensaje: "falla de prueba" } }),
      ZONA,
    );

    expect(envio).toEqual({ estado: "sin-dato", motivo: "falla de prueba" });
  });
});

describe("vistaSalud — pendientes del badge", () => {
  test("cuenta plantillas pausadas, números en media o baja y el envío frenado", () => {
    const v = vistaSalud(
      salud({
        ...conNumeros([
          numero(),
          numero({ id: "102", calidad: "YELLOW", esElConfigurado: false }),
          numero({ id: "103", calidad: "NA", esElConfigurado: false }),
        ]),
        ...conPlantillas([
          plantilla({ id: "1", estado: "PAUSED" }),
          plantilla({ id: "2", estado: "REJECTED" }),
        ]),
        estadoDeEnvio: { estado: "ok", valor: { puedeEnviar: "LIMITED", entidades: [] } },
      }),
      ZONA,
    );

    expect(v.pendientes).toBe(3);
  });

  test("sin nada para atender, cero", () => {
    expect(vistaSalud(salud(), ZONA).pendientes).toBe(0);
  });
});

describe("vistaSalud — fuente", () => {
  test("dice de qué versión de la API y a qué hora del negocio se leyó", () => {
    const { fuente } = vistaSalud(salud(), ZONA);

    expect(fuente).toContain("v21.0");
    expect(fuente).toContain(fechaLegibleEnZona(ZONA, CONSULTADO));
  });
});

describe("vistaEmpresa", () => {
  test("sin fila no inventa datos: registro null y la zona del agente", () => {
    expect(vistaEmpresa(null, ZONA)).toEqual({ registro: null, zonaHoraria: ZONA });
  });

  test("con fila, nombre e identificación fiscal", () => {
    expect(
      vistaEmpresa(
        {
          id: "00000000-0000-4000-8000-000000000001",
          nombre: "Repuestos de Prueba",
          ruc_nit: null,
          created_at: new Date("2026-05-12T00:00:00Z"),
        },
        null,
      ),
    ).toEqual({
      registro: { nombre: "Repuestos de Prueba", identificacionFiscal: null },
      zonaHoraria: null,
    });
  });
});

describe("vistaUsuarios", () => {
  const creado = new Date("2026-05-12T00:00:00Z");
  const usuarios: Usuario[] = [
    {
      id: "u1",
      nombre: "Zoe",
      email: "zoe@crm.local",
      rol: "vendedor",
      activo: true,
      created_at: creado,
    },
    {
      id: "u2",
      nombre: "Ana",
      email: "ana@crm.local",
      rol: "vendedor",
      activo: false,
      created_at: creado,
    },
    {
      id: "u3",
      nombre: "Bruno",
      email: "bruno@crm.local",
      rol: "admin",
      activo: true,
      created_at: creado,
    },
    {
      id: "u4",
      nombre: "Ábel",
      email: "abel@crm.local",
      rol: "vendedor",
      activo: true,
      created_at: creado,
    },
  ];

  test("activos primero, admins antes que vendedores, y por nombre", () => {
    expect(vistaUsuarios(usuarios).map((u) => u.nombre)).toEqual(["Bruno", "Ábel", "Zoe", "Ana"]);
  });

  test("el último acceso queda sin dato: no está en la tabla usuarios", () => {
    expect(vistaUsuarios(usuarios).every((u) => u.ultimoAcceso.estado === "sin-dato")).toBe(true);
  });

  test("conserva email, rol y si está activo", () => {
    expect(vistaUsuarios([usuarios[1]!])[0]).toMatchObject({
      id: "u2",
      email: "ana@crm.local",
      rol: "vendedor",
      activo: false,
    });
  });
});

describe("vistaHorario", () => {
  const horario: Horario = {
    lun: [
      { desde: "15:00", hasta: "19:00" },
      { desde: "09:00", hasta: "13:00" },
    ],
    mar: [{ desde: "09:00", hasta: "18:00" }],
    mie: [],
    jue: [],
    vie: [],
    sab: [{ desde: "18:00", hasta: "09:00" }],
    dom: [],
  };

  test("va de lunes a domingo con nombre y abreviatura", () => {
    expect(vistaHorario(horario).map((f) => [f.dia, f.abreviatura])).toEqual([
      ["Lunes", "LU"],
      ["Martes", "MA"],
      ["Miércoles", "MI"],
      ["Jueves", "JU"],
      ["Viernes", "VI"],
      ["Sábado", "SA"],
      ["Domingo", "DO"],
    ]);
  });

  test("conserva los dos turnos de un día partido, ordenados", () => {
    expect(vistaHorario(horario)[0]?.rangos).toEqual([
      { desde: "09:00", hasta: "13:00" },
      { desde: "15:00", hasta: "19:00" },
    ]);
  });

  test("un día sin rangos queda cerrado", () => {
    expect(vistaHorario(horario)[2]?.rangos).toEqual([]);
  });

  test("un rango invertido no se muestra: el agente tampoco abre con él", () => {
    expect(vistaHorario(horario)[5]?.rangos).toEqual([]);
  });
});

describe("textoFueraDeHorario", () => {
  test("con respuesta fija configurada, la cita", () => {
    expect(textoFueraDeHorario("Volvemos a las 9.")).toContain("«Volvemos a las 9.»");
  });

  test("sin respuesta fija, dice que no se contesta", () => {
    expect(textoFueraDeHorario("")).toMatch(/no se contesta/);
  });
});

describe("vistaSaltos", () => {
  const porMotivo = {
    tope_frecuencia: 12,
    dado_de_baja: 0,
    sin_ventana: 3,
    conversacion_activa: 0,
    requiere_humano: 1,
  };

  test("una fila por tope que hoy salta mensajes, en el orden del PRD, con su número", () => {
    const v = vistaSaltos({ desde: CONSULTADO, porMotivo });
    expect(v.filas.map((f) => [f.motivo, f.cantidad])).toEqual([
      ["tope_frecuencia", 12],
      ["dado_de_baja", 0],
      ["sin_ventana", 3],
      ["requiere_humano", 1],
    ]);
    expect(v.total).toBe(16);
  });

  test("conversación activa no se lista: ningún flujo la aplica todavía", () => {
    const v = vistaSaltos({
      desde: CONSULTADO,
      porMotivo: { ...porMotivo, conversacion_activa: 5 },
    });
    expect(v.filas.some((f) => f.motivo === "conversacion_activa")).toBe(false);
    expect(v.total).toBe(16);
  });

  test("cada fila trae el nombre y la explicación en palabras, no el código", () => {
    const [primera] = vistaSaltos({ desde: CONSULTADO, porMotivo }).filas;
    expect(primera?.label).toBe("Tope de mensajes");
    expect(primera?.explicacion).toMatch(/24 horas/);
  });
});
