import { describe, expect, it } from "vitest";
import { configDeAccion, revisarConfig } from "@/lib/workflows/config-nodos";
import { disponibilidadDeTipo } from "@/lib/workflows/disponibilidad";
import { ACCION_DE_TIPO } from "@/lib/workflows/catalogo";
import { opcionesDeNodo } from "@/lib/workflows/opciones-interactivas";
import { etiquetaDePuerto, puertosDeNodo, validarGrafo } from "@/lib/workflows/validar-grafo";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import {
  puertoDeOpcion,
  type Arista,
  type Grafo,
  type Nodo,
  type NodoTipo,
} from "@/types/workflows";

/**
 * Botones, lista, imagen y ubicación: el contrato que comparten la config, el
 * validador y la paleta. Los límites son los de la documentación de Meta
 * (leída el 2026-09-26): 3 botones de ≤20 caracteres; lista con ≤10 filas en
 * total, título de fila ≤24, descripción ≤72, botón ≤20, body ≤4096.
 */

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}
function a(desde: string, hasta: string, puerto: Arista["puerto"] = "salida"): Arista {
  return { desde, hasta, puerto };
}
const errores = (tipo: NodoTipo, config: Record<string, unknown>) =>
  revisarConfig({ tipo, config })?.errores ?? [];

const BOTONES = {
  mensaje: "¿Te lo reservo?",
  botones: [
    { id: "si", texto: "Sí" },
    { id: "no", texto: "No" },
  ],
};

const LISTA = {
  body: "¿Qué buscás?",
  secciones: [
    {
      titulo: "Motor",
      items: [
        { id: "filtro", titulo: "Filtro", descripcion: "De aceite" },
        { id: "bujia", titulo: "Bujía", descripcion: "" },
      ],
    },
  ],
};

describe("disponibilidad", () => {
  it.each(["msg_botones", "msg_lista", "msg_imagen", "msg_ubicacion"] as const)(
    "%s ya corre y tiene su acción",
    (tipo) => {
      expect(disponibilidadDeTipo(tipo)).toEqual({ disponible: true });
      expect(ACCION_DE_TIPO[tipo]).toBeDefined();
    },
  );
});

describe("config de botones", () => {
  it("una config completa no tiene errores y trae el tiempo máximo por defecto", () => {
    expect(errores("msg_botones", BOTONES)).toEqual([]);
    const c = configDeAccion("enviar_botones", { id: "b", config: BOTONES });
    expect(c.timeout).toBe(24);
    expect(c.unidadTimeout).toBe("horas");
  });

  it("más de 3 botones no se puede publicar: Meta no lo manda", () => {
    const config = {
      ...BOTONES,
      botones: ["a", "b", "c", "d"].map((id) => ({ id, texto: id })),
    };
    expect(errores("msg_botones", config).join(" ")).toMatch(/3 botones/);
  });

  it("un texto de botón de más de 20 caracteres es un error", () => {
    const config = { ...BOTONES, botones: [{ id: "x", texto: "a".repeat(21) }] };
    expect(errores("msg_botones", config).join(" ")).toMatch(/20/);
  });

  it("un botón sin texto es un error", () => {
    const config = { ...BOTONES, botones: [{ id: "x", texto: " " }] };
    expect(errores("msg_botones", config).length).toBeGreaterThan(0);
  });

  it("dos botones con el mismo id se rechazan: cada uno es una salida", () => {
    const config = {
      ...BOTONES,
      botones: [
        { id: "x", texto: "A" },
        { id: "x", texto: "B" },
      ],
    };
    expect(errores("msg_botones", config).join(" ")).toMatch(/repet/i);
  });

  it("el tiempo máximo tiene que ser positivo: ninguna espera es indefinida", () => {
    expect(errores("msg_botones", { ...BOTONES, timeout: 0 }).length).toBeGreaterThan(0);
  });
});

describe("config de lista", () => {
  it("una config completa no tiene errores; el título es opcional", () => {
    expect(errores("msg_lista", LISTA)).toEqual([]);
  });

  it("sin mensaje no se manda: Meta exige el body", () => {
    expect(errores("msg_lista", { ...LISTA, body: "" }).length).toBeGreaterThan(0);
  });

  it("más de 10 filas en total es un error", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`,
      titulo: `F${i}`,
      descripcion: "",
    }));
    const items2 = items.map((it) => ({ ...it, id: `${it.id}b` }));
    const config = {
      ...LISTA,
      secciones: [
        { titulo: "A", items },
        { titulo: "B", items: items2 },
      ],
    };
    expect(errores("msg_lista", config).join(" ")).toMatch(/10/);
  });

  it("título de fila de más de 24 o descripción de más de 72 son errores", () => {
    const largo = {
      ...LISTA,
      secciones: [{ titulo: "", items: [{ id: "x", titulo: "a".repeat(25), descripcion: "" }] }],
    };
    expect(errores("msg_lista", largo).join(" ")).toMatch(/24/);
    const desc = {
      ...LISTA,
      secciones: [{ titulo: "", items: [{ id: "x", titulo: "a", descripcion: "d".repeat(73) }] }],
    };
    expect(errores("msg_lista", desc).join(" ")).toMatch(/72/);
  });
});

describe("config de imagen", () => {
  it("por URL exige https", () => {
    expect(errores("msg_imagen", { url: "https://x.test/a.jpg" })).toEqual([]);
    expect(errores("msg_imagen", { url: "http://x.test/a.jpg" }).length).toBeGreaterThan(0);
    expect(errores("msg_imagen", { url: "javascript:alert(1)" }).length).toBeGreaterThan(0);
  });

  it("por archivo exige una ruta subida por el panel", () => {
    const ok = { tipoMedia: "archivo", archivo: "flujos/0f8fad5b-d9cb-469f-a165-70867728950e.jpg" };
    expect(errores("msg_imagen", ok)).toEqual([]);
    expect(errores("msg_imagen", { tipoMedia: "archivo" }).length).toBeGreaterThan(0);
    expect(
      errores("msg_imagen", { tipoMedia: "archivo", archivo: "../comprobantes_pago/x.jpg" }).length,
    ).toBeGreaterThan(0);
  });

  it("el pie de foto no pasa de 1024", () => {
    expect(
      errores("msg_imagen", { url: "https://x.test/a.jpg", caption: "a".repeat(1025) }).length,
    ).toBeGreaterThan(0);
  });
});

describe("config de ubicación", () => {
  it("exige latitud y longitud dentro de rango", () => {
    expect(errores("msg_ubicacion", { lat: -2.17, lon: -79.92 })).toEqual([]);
    expect(errores("msg_ubicacion", {}).length).toBeGreaterThan(0);
    expect(errores("msg_ubicacion", { lat: 91, lon: 0 }).length).toBeGreaterThan(0);
    expect(errores("msg_ubicacion", { lat: 0, lon: 181 }).length).toBeGreaterThan(0);
  });
});

describe("puertos por opción", () => {
  it("botones: una salida por botón, en orden, y «sin respuesta» al final", () => {
    const b = nodo("b", "msg_botones", BOTONES);
    expect(puertosDeNodo(b)).toEqual(["opcion:si", "opcion:no", "sin_respuesta"]);
    expect(opcionesDeNodo(b)).toEqual([
      { id: "si", titulo: "Sí" },
      { id: "no", titulo: "No" },
    ]);
  });

  it("lista: una salida por fila de todas las secciones", () => {
    const l = nodo("l", "msg_lista", LISTA);
    expect(puertosDeNodo(l)).toEqual(["opcion:filtro", "opcion:bujia", "sin_respuesta"]);
  });

  it("sin opciones cargadas le queda sólo «sin respuesta»", () => {
    expect(puertosDeNodo(nodo("b", "msg_botones"))).toEqual(["sin_respuesta"]);
  });

  it("imagen y ubicación tienen una sola salida", () => {
    expect(puertosDeNodo(nodo("i", "msg_imagen"))).toEqual(["salida"]);
    expect(puertosDeNodo(nodo("u", "msg_ubicacion"))).toEqual(["salida"]);
  });

  it("rotula cada salida con el texto de la opción", () => {
    const b = nodo("b", "msg_botones", BOTONES);
    expect(etiquetaDePuerto(b, puertoDeOpcion("no"))).toBe("No");
    expect(etiquetaDePuerto(b, "sin_respuesta")).toBe("Sin respuesta");
  });

  it("el validador exige conectar cada opción y «sin respuesta»", () => {
    const base: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("b", "msg_botones", BOTONES),
        nodo("f1", "logica_detener"),
        nodo("f2", "logica_detener"),
      ],
      aristas: [a("t", "b"), a("b", "f1", puertoDeOpcion("si"))],
    };
    const faltan = validarGrafo(base)
      .filter((p) => p.regla === "salida_sin_conectar")
      .map((p) => p.mensaje)
      .join(" ");
    expect(faltan).toMatch(/opcion:no|No/);
    expect(faltan).toMatch(/sin_respuesta|Sin respuesta/);

    const completo: Grafo = {
      ...base,
      aristas: [...base.aristas, a("b", "f2", puertoDeOpcion("no")), a("b", "f2", "sin_respuesta")],
    };
    expect(validarGrafo(completo)).toEqual([]);
    expect(GrafoSchema.safeParse(completo).success).toBe(true);
  });
});

describe("nuevoIdDeOpcion", () => {
  it("sigue después del mayor: no recicla el hueco de una opción borrada", async () => {
    const { nuevoIdDeOpcion } = await import("@/lib/workflows/opciones-interactivas");
    expect(nuevoIdDeOpcion([])).toBe("op1");
    expect(nuevoIdDeOpcion(["op1", "op3"])).toBe("op4");
    expect(nuevoIdDeOpcion(["si", "op2"])).toBe("op3");
  });
});
