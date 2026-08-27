import { describe, it, expect } from "vitest";
import {
  evaluarCondicion,
  evaluarCondiciones,
  evaluarGrupo,
  type Condicion,
  type GrupoCondiciones,
} from "@/lib/workflows/engine/evaluador-condicion";
import {
  crearContextoVacio,
  type ContextoEjecucion,
} from "@/lib/workflows/engine/contexto-ejecucion";

function crearContextoPrueba(overrides: Partial<ContextoEjecucion> = {}): ContextoEjecucion {
  const base = crearContextoVacio({
    workflowId: "wf-1",
    runId: "run-1",
    versionId: "ver-1",
    trigger: { tipo: "manual", datos: { origen: "test", prioridad: 5 } },
  });

  return {
    ...base,
    lead: {
      id: "lead-1",
      nombre: "Juan Perez",
      telefono: "+5491155667788",
      email: "juan@test.com",
      direccion: null,
      datos_extra: {},
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2020,
      vehiculo_motor: "1.8",
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: {},
      created_at: new Date(),
      updated_at: new Date(),
      nombre_perfil: "Juan",
    },
    sesion: {
      id: "ses-1",
      lead_id: "lead-1",
      current_stage: "cotizado",
      etapa_alcanzada: "cotizado",
      urgencia: "alta",
      consulta: "Busco repuesto para Corolla 2020",
      producto_cotizado_id: null,
      codigo_interno: "ABC123",
      precio_cotizado: 150.5,
      cantidad: 2,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: false,
      extras: {},
      context_summary: null,
      procedencia: {},
      started_at: new Date(),
      updated_at: new Date(),
      closed_at: null,
    },
    ...overrides,
  };
}

describe("evaluarCondicion - operador 'es'", () => {
  it("true cuando los valores son iguales (string)", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "es",
      valor: "Juan Perez",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando los valores son diferentes", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "es",
      valor: "Maria Lopez",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("true cuando ambos son null", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.bloqueador",
      operador: "es",
      valor: null,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });
});

describe("evaluarCondicion - operador 'no_es'", () => {
  it("true cuando los valores son diferentes", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.current_stage",
      operador: "no_es",
      valor: "perdido",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando los valores son iguales", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.current_stage",
      operador: "no_es",
      valor: "cotizado",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });
});

describe("evaluarCondicion - operador 'contiene'", () => {
  it("true cuando el texto contiene la subcadena", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.consulta",
      operador: "contiene",
      valor: "Corolla",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("true con búsqueda case-insensitive", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.consulta",
      operador: "contiene",
      valor: "corolla",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando no contiene la subcadena", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.consulta",
      operador: "contiene",
      valor: "Hilux",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("false cuando el campo es null", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.bloqueador",
      operador: "contiene",
      valor: "algo",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });
});

describe("evaluarCondicion - operador 'no_contiene'", () => {
  it("true cuando no contiene la subcadena", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.consulta",
      operador: "no_contiene",
      valor: "Hilux",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando contiene la subcadena", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.consulta",
      operador: "no_contiene",
      valor: "repuesto",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("true cuando el campo es null", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.bloqueador",
      operador: "no_contiene",
      valor: "algo",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });
});

describe("evaluarCondicion - operadores numéricos", () => {
  it("mayor_que: true cuando A > B", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.precio_cotizado",
      operador: "mayor_que",
      valor: 100,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("mayor_que: false cuando A <= B", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.precio_cotizado",
      operador: "mayor_que",
      valor: 200,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("menor_que: true cuando A < B", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.cantidad",
      operador: "menor_que",
      valor: 10,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("mayor_igual: true cuando A >= B", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.precio_cotizado",
      operador: "mayor_igual",
      valor: 150.5,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("menor_igual: true cuando A <= B", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.cantidad",
      operador: "menor_igual",
      valor: 2,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando el campo es null", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.bloqueador",
      operador: "mayor_que",
      valor: 0,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("false cuando no son números válidos", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "mayor_que",
      valor: 10,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });
});

describe("evaluarCondicion - operador 'existe'", () => {
  it("true cuando el campo tiene valor", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "existe",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando el campo es null", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.bloqueador",
      operador: "existe",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("false cuando el campo es string vacío", () => {
    const ctx = crearContextoPrueba();
    ctx.variables.set("vacio", "");
    const cond: Condicion = {
      campo: "var.vacio",
      operador: "existe",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });
});

describe("evaluarCondicion - operador 'no_existe'", () => {
  it("true cuando el campo es null", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.bloqueador",
      operador: "no_existe",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("true cuando el campo es string vacío", () => {
    const ctx = crearContextoPrueba();
    ctx.variables.set("vacio", "");
    const cond: Condicion = {
      campo: "var.vacio",
      operador: "no_existe",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando el campo tiene valor", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "no_existe",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });
});

describe("evaluarCondicion - operadores de texto", () => {
  it("empieza_con: true cuando el texto empieza con el valor", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "empieza_con",
      valor: "Juan",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("empieza_con: case-insensitive", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "empieza_con",
      valor: "juan",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("termina_con: true cuando el texto termina con el valor", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "termina_con",
      valor: "Perez",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });
});

describe("evaluarCondicion - operador 'en_lista'", () => {
  it("true cuando el valor está en la lista", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.current_stage",
      operador: "en_lista",
      valor: ["nuevo", "cotizado", "negociando"],
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando el valor no está en la lista", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.current_stage",
      operador: "en_lista",
      valor: ["nuevo", "cerrado"],
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("comparación case-insensitive para strings", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.vehiculo_marca",
      operador: "en_lista",
      valor: ["toyota", "honda", "nissan"],
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });
});

describe("evaluarCondicion - operador 'no_en_lista'", () => {
  it("true cuando el valor no está en la lista", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.current_stage",
      operador: "no_en_lista",
      valor: ["perdido", "cerrado"],
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando el valor está en la lista", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "sesion.current_stage",
      operador: "no_en_lista",
      valor: ["cotizado", "cerrado"],
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });
});

describe("evaluarCondicion - operador 'regex'", () => {
  it("true cuando el regex matchea", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.telefono",
      operador: "regex",
      valor: "^\\+54",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("false cuando el regex no matchea", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.telefono",
      operador: "regex",
      valor: "^\\+55",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });

  it("false con regex inválido (no lanza error)", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "lead.nombre",
      operador: "regex",
      valor: "[invalid(",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(false);
  });
});

describe("evaluarCondicion - campos de variables", () => {
  it("evalúa variables acumuladas", () => {
    const ctx = crearContextoPrueba();
    ctx.variables.set("resultado", "exito");

    const cond: Condicion = {
      campo: "var.resultado",
      operador: "es",
      valor: "exito",
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });

  it("evalúa datos del trigger", () => {
    const ctx = crearContextoPrueba();
    const cond: Condicion = {
      campo: "trigger.prioridad",
      operador: "mayor_que",
      valor: 3,
    };

    expect(evaluarCondicion(cond, ctx)).toBe(true);
  });
});

describe("evaluarGrupo", () => {
  it("operador 'y': true cuando todas son true", () => {
    const ctx = crearContextoPrueba();
    const grupo: GrupoCondiciones = {
      operador: "y",
      condiciones: [
        { campo: "lead.vehiculo_marca", operador: "es", valor: "Toyota" },
        { campo: "sesion.current_stage", operador: "es", valor: "cotizado" },
      ],
    };

    expect(evaluarGrupo(grupo, ctx)).toBe(true);
  });

  it("operador 'y': false cuando alguna es false", () => {
    const ctx = crearContextoPrueba();
    const grupo: GrupoCondiciones = {
      operador: "y",
      condiciones: [
        { campo: "lead.vehiculo_marca", operador: "es", valor: "Toyota" },
        { campo: "sesion.current_stage", operador: "es", valor: "perdido" },
      ],
    };

    expect(evaluarGrupo(grupo, ctx)).toBe(false);
  });

  it("operador 'o': true cuando al menos una es true", () => {
    const ctx = crearContextoPrueba();
    const grupo: GrupoCondiciones = {
      operador: "o",
      condiciones: [
        { campo: "lead.vehiculo_marca", operador: "es", valor: "Honda" },
        { campo: "sesion.current_stage", operador: "es", valor: "cotizado" },
      ],
    };

    expect(evaluarGrupo(grupo, ctx)).toBe(true);
  });

  it("operador 'o': false cuando todas son false", () => {
    const ctx = crearContextoPrueba();
    const grupo: GrupoCondiciones = {
      operador: "o",
      condiciones: [
        { campo: "lead.vehiculo_marca", operador: "es", valor: "Honda" },
        { campo: "sesion.current_stage", operador: "es", valor: "perdido" },
      ],
    };

    expect(evaluarGrupo(grupo, ctx)).toBe(false);
  });

  it("grupo vacío devuelve true", () => {
    const ctx = crearContextoPrueba();
    const grupo: GrupoCondiciones = {
      operador: "y",
      condiciones: [],
    };

    expect(evaluarGrupo(grupo, ctx)).toBe(true);
  });
});

describe("evaluarCondiciones", () => {
  it("array de condiciones asume AND", () => {
    const ctx = crearContextoPrueba();
    const condiciones: Condicion[] = [
      { campo: "lead.vehiculo_marca", operador: "es", valor: "Toyota" },
      { campo: "sesion.precio_cotizado", operador: "mayor_que", valor: 100 },
    ];

    expect(evaluarCondiciones(condiciones, ctx)).toBe(true);
  });

  it("acepta GrupoCondiciones", () => {
    const ctx = crearContextoPrueba();
    const grupo: GrupoCondiciones = {
      operador: "o",
      condiciones: [
        { campo: "lead.vehiculo_marca", operador: "es", valor: "Honda" },
        { campo: "lead.vehiculo_marca", operador: "es", valor: "Toyota" },
      ],
    };

    expect(evaluarCondiciones(grupo, ctx)).toBe(true);
  });

  it("undefined devuelve true", () => {
    const ctx = crearContextoPrueba();

    expect(evaluarCondiciones(undefined, ctx)).toBe(true);
  });
});
