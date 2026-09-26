import { describe, expect, it } from "vitest";
import { disponibilidadDeTipo } from "@/lib/workflows/disponibilidad";
import { revisarConfig } from "@/lib/workflows/config-nodos";
import {
  etiquetaDePuerto,
  puertosDe,
  puertosDeNodo,
  validarGrafo,
} from "@/lib/workflows/validar-grafo";
import { problemasDelEditor } from "@/lib/workflows/problemas-editor";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import { puertoDeCaso, type Arista, type Grafo, type Nodo, type NodoTipo } from "@/types/workflows";

/**
 * "Según el valor" (switch), "Ir a" (goto) y "Actualizar campo del Twin": el
 * contrato que comparten el validador, la config y la paleta. El motor tiene
 * su propio archivo (`ejecutor-switch-goto.test.ts`).
 */

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}
function a(desde: string, hasta: string, puerto: Arista["puerto"] = "salida"): Arista {
  return { desde, hasta, puerto };
}

const CASOS = [
  { id: "c1", valor: "wa" },
  { id: "c2", valor: "ig" },
];

function grafoSwitch(aristasExtra: Arista[] = [], casos = CASOS): Grafo {
  return {
    nodos: [
      nodo("t", "trigger_mensaje"),
      nodo("s", "logica_switch", { campo: "lead.canal", casos }),
      nodo("f1", "logica_detener"),
      nodo("f2", "logica_detener"),
      nodo("f3", "logica_detener"),
    ],
    aristas: [a("t", "s"), ...aristasExtra],
  };
}

const CONECTADO = [
  a("s", "f1", puertoDeCaso("c1")),
  a("s", "f2", puertoDeCaso("c2")),
  a("s", "f3", "otro"),
];

describe("Según el valor (switch): puertos", () => {
  it("tiene un puerto por caso, en orden, y uno «otro» al final", () => {
    const s = nodo("s", "logica_switch", { campo: "lead.canal", casos: CASOS });
    expect(puertosDeNodo(s)).toEqual(["caso:c1", "caso:c2", "otro"]);
  });

  it("sin casos le queda sólo «otro»", () => {
    expect(puertosDeNodo(nodo("s", "logica_switch"))).toEqual(["otro"]);
    expect(puertosDe("logica_switch")).toEqual(["otro"]);
  });

  it("rotula cada puerto con el valor del caso", () => {
    const s = nodo("s", "logica_switch", { campo: "lead.canal", casos: CASOS });
    expect(etiquetaDePuerto(s, puertoDeCaso("c2"))).toBe("ig");
    expect(etiquetaDePuerto(s, "otro")).toBe("Otro");
  });

  it("el schema del grafo acepta un puerto de caso y rechaza uno inventado", () => {
    const g = grafoSwitch(CONECTADO);
    expect(GrafoSchema.safeParse(g).success).toBe(true);
    const malo = grafoSwitch([a("s", "f1", "cualquiera" as Arista["puerto"])]);
    expect(GrafoSchema.safeParse(malo).success).toBe(false);
  });
});

describe("Según el valor (switch): validador", () => {
  it("con cada caso y «otro» conectados, el grafo es válido", () => {
    expect(validarGrafo(grafoSwitch(CONECTADO))).toEqual([]);
  });

  it("un caso sin su salida conectada se rechaza, nombrando el caso", () => {
    // f2 queda suelto y eso es otra regla: acá importa la del switch.
    const problemas = validarGrafo(
      grafoSwitch([a("s", "f1", puertoDeCaso("c1")), a("s", "f3", "otro")]),
    ).filter((p) => p.regla !== "nodo_inalcanzable");
    expect(problemas).toHaveLength(1);
    expect(problemas[0]!.regla).toBe("condicion_puertos");
    expect(problemas[0]!.nodos).toEqual(["s"]);
    expect(problemas[0]!.mensaje).toContain("«ig»");
  });

  it("sin «otro» conectado se rechaza", () => {
    const problemas = validarGrafo(
      grafoSwitch([a("s", "f1", puertoDeCaso("c1")), a("s", "f2", puertoDeCaso("c2"))]),
    ).filter((p) => p.regla !== "nodo_inalcanzable");
    expect(problemas.map((p) => p.regla)).toEqual(["condicion_puertos"]);
    expect(problemas[0]!.mensaje).toContain("«Otro»");
  });

  it("una línea que sale por un caso que ya no existe se rechaza", () => {
    const problemas = validarGrafo(
      grafoSwitch([...CONECTADO, a("s", "f1", puertoDeCaso("borrado"))]),
    );
    expect(problemas.map((p) => p.regla)).toEqual(["condicion_puertos"]);
  });

  it("dos líneas por el mismo caso se rechazan", () => {
    const problemas = validarGrafo(grafoSwitch([...CONECTADO, a("s", "f2", puertoDeCaso("c1"))]));
    expect(problemas.map((p) => p.regla)).toEqual(["condicion_puertos"]);
  });

  it("el editor cuelga del nodo un problema por salida suelta, con «Detener» para cerrarla", () => {
    const g = grafoSwitch([a("s", "f3", "otro")]);
    const delSwitch = problemasDelEditor(g).porNodo.filter((p) => p.nodoId === "s");
    expect(delSwitch.map((p) => p.mensaje)).toEqual([
      "La salida «wa» no lleva a ningún paso.",
      "La salida «ig» no lleva a ningún paso.",
    ]);
    expect(delSwitch[0]!.arreglos[0]!.arreglo).toEqual({
      tipo: "agregar_detener",
      desde: "s",
      puerto: "caso:c1",
    });
  });
});

describe("Según el valor (switch): config", () => {
  const errores = (config: Record<string, unknown>) =>
    revisarConfig(nodo("s", "logica_switch", config))!.errores;

  it("bien armado no tiene errores", () => {
    expect(errores({ campo: "lead.canal", casos: CASOS })).toEqual([]);
  });

  it("pide al menos un caso", () => {
    expect(errores({ campo: "lead.canal", casos: [] })).toEqual([
      "Agregá al menos un caso: sin casos todo sale por «Otro»",
    ]);
  });

  it("rechaza un caso sin valor", () => {
    expect(errores({ campo: "lead.canal", casos: [{ id: "c1", valor: " " }] })).toEqual([
      "Hay un caso sin valor",
    ]);
  });

  it("rechaza dos casos con el mismo valor: el segundo no se alcanzaría nunca", () => {
    expect(
      errores({
        campo: "lead.canal",
        casos: [
          { id: "c1", valor: "wa" },
          { id: "c2", valor: "wa" },
        ],
      }),
    ).toEqual(["Dos casos tienen el valor «wa»: el segundo no se alcanzaría nunca"]);
  });

  it("sólo acepta campos que se comparan por igualdad", () => {
    expect(errores({ campo: "sesion.precio_cotizado", casos: CASOS })).toEqual([
      "«Según el valor» compara por igualdad: elegí un campo de texto o de opciones",
    ]);
  });
});

describe("Ir a (goto)", () => {
  function grafoGoto(destino: unknown, extra: Nodo[] = []): Grafo {
    return {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("e", "logica_esperar"),
        nodo("x", "msg_texto", { mensaje: "hola" }),
        nodo("g", "logica_goto", destino === undefined ? {} : { nodoDestino: destino }),
        ...extra,
      ],
      aristas: [a("t", "e"), a("e", "x"), a("x", "g")],
    };
  }

  it("no tiene puertos: la línea es el destino que eligió", () => {
    expect(puertosDe("logica_goto")).toEqual([]);
  });

  it("volver a un paso con una espera en el medio es válido", () => {
    expect(validarGrafo(grafoGoto("e"))).toEqual([]);
  });

  it("sin destino se rechaza", () => {
    const problemas = validarGrafo(grafoGoto(undefined));
    expect(problemas.map((p) => p.regla)).toEqual(["ir_a_destino"]);
    expect(problemas[0]!.nodos).toEqual(["g"]);
  });

  it("un destino que ya no existe (el nodo se borró) se rechaza", () => {
    const problemas = validarGrafo(grafoGoto("borrado"));
    expect(problemas.map((p) => p.regla)).toEqual(["ir_a_destino"]);
  });

  it("un salto que cierra un ciclo sin espera se rechaza igual que una línea", () => {
    const problemas = validarGrafo(grafoGoto("x"));
    expect(problemas.map((p) => p.regla)).toEqual(["ciclo_sin_espera"]);
    expect(problemas[0]!.nodos).toEqual(expect.arrayContaining(["x", "g"]));
  });

  it("saltar al disparador se rechaza como cualquier vuelta al inicio", () => {
    const problemas = validarGrafo(grafoGoto("t"));
    expect(problemas.map((p) => p.regla)).toContain("disparador_sin_entrantes");
  });

  it("el destino de un salto cuenta como alcanzable", () => {
    const g = grafoGoto("f", [nodo("f", "logica_detener")]);
    expect(validarGrafo(g)).toEqual([]);
  });

  it("el editor cuelga del salto el destino que falta", () => {
    const delSalto = problemasDelEditor(grafoGoto("borrado")).porNodo.filter(
      (p) => p.nodoId === "g",
    );
    expect(delSalto.map((p) => p.regla)).toEqual(["ir_a_destino"]);
  });
});

describe("Actualizar campo del Twin: config", () => {
  const revision = (config: Record<string, unknown>) =>
    revisarConfig(nodo("c", "crm_campo", config))!;

  it("acepta un campo editable del Twin con un valor", () => {
    expect(revision({ campo: "bloqueador", valor: "Espera el pago" }).errores).toEqual([]);
  });

  it("rechaza un campo que el Twin no deja editar", () => {
    expect(revision({ campo: "ia_pausada", valor: "true" }).errores).toEqual([
      "Elegí un campo del Twin que se pueda editar",
    ]);
  });

  it("un número escrito a mano en un campo numérico tiene que ser un número", () => {
    expect(revision({ campo: "cantidad", valor: "dos" }).errores).toEqual([
      "«cantidad» es un número entero: «dos» no lo es",
    ]);
    expect(revision({ campo: "precio_cotizado", valor: "1500,50" }).errores).toEqual([]);
    // Con una variable, el número recién se sabe al correr.
    expect(revision({ campo: "cantidad", valor: "{{lead.nombre}}" }).errores).toEqual([]);
  });

  it("vacío borra el dato: se avisa, no se bloquea", () => {
    const r = revision({ campo: "bloqueador", valor: "" });
    expect(r.errores).toEqual([]);
    expect(r.advertencias.map((w) => w.mensaje)).toEqual([
      "El valor está vacío: el bloque borra lo que haya en el campo",
    ]);
  });
});

describe("disponibilidad", () => {
  it.each(["logica_switch", "logica_goto", "crm_campo"] as const)("%s se puede ejecutar", (t) => {
    expect(disponibilidadDeTipo(t)).toEqual({ disponible: true });
  });

  // El diseño no los dibuja y el motor no los soporta sin inventarles semántica.
  it.each(["logica_loop", "logica_error", "logica_validacion", "logica_grupo"] as const)(
    "%s sigue sin poder ejecutarse, con su motivo",
    (t) => {
      const d = disponibilidadDeTipo(t);
      expect(d.disponible).toBe(false);
    },
  );
});
