import { describe, expect, it } from "vitest";
import {
  armarPlantilla,
  bloquesQueNoCorren,
} from "@/app/(panel)/workflows/nuevo/_lib/grafos-plantillas";
import { MEDIDAS } from "@/components/workflows/editor/tokens-editor";
import { PLANTILLAS } from "@/components/workflows/lista/plantillas";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";
import { disponibilidadDeTipo } from "@/lib/workflows/disponibilidad";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import { problemasParaPublicar } from "@/lib/workflows/validar-workflow";
import { CURRENT_STAGE, ETAPAS_EMBUDO } from "@/types/domain";
import { esCondicion, esTrigger } from "@/types/workflows";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

/**
 * La traducción de las seis plantillas de la galería a un grafo.
 *
 * Antes no existía y el flujo nacía vacío mientras la pantalla prometía un
 * lienzo armado. Lo que estos tests protegen es que esa promesa sea cierta:
 * que cada plantilla produzca un grafo que el servicio acepte (`validarGrafo`
 * es la misma puerta que `guardarVersion`), con los pasos que dice la tarjeta y
 * con valores que los formularios del panel sepan mostrar.
 */

function armado(id: string): NonNullable<ReturnType<typeof armarPlantilla>> {
  const a = armarPlantilla(id);
  if (!a) throw new Error(`la plantilla ${id} no arma nada`);
  return a;
}

function nodoPorId(g: Grafo, id: string): Nodo {
  const n = g.nodos.find((x) => x.id === id);
  if (!n) throw new Error(`no hay nodo ${id}`);
  return n;
}

/** Tipos por el camino que sigue la plantilla cuando todo "da que sí". */
function caminoPrincipal(g: Grafo): NodoTipo[] {
  const disparador = g.nodos.find((n) => esTrigger(n.tipo));
  if (!disparador) return [];
  const tipos: NodoTipo[] = [];
  const vistos = new Set<string>();
  let actual: string | undefined = disparador.id;
  while (actual !== undefined && !vistos.has(actual)) {
    vistos.add(actual);
    tipos.push(nodoPorId(g, actual).tipo);
    const desde: string = actual;
    actual = g.aristas.find(
      (a) => a.desde === desde && (a.puerto === "salida" || a.puerto === "verdadero"),
    )?.hasta;
  }
  return tipos;
}

/**
 * Si al nodo le falta lo que sólo el negocio sabe (qué etiqueta, qué texto,
 * qué plantilla de Meta). Las claves son las que escriben los formularios de
 * `canvas/config/`, porque es lo que el panel muestra.
 */
function leFaltaAlgo(n: Nodo): boolean {
  const c = n.config;
  switch (n.tipo) {
    case "logica_condicion":
      return typeof c.campo !== "string" || c.campo === "";
    case "msg_texto":
    case "int_notif_vendedor":
      return typeof c.mensaje !== "string" || c.mensaje.trim() === "";
    case "msg_plantilla":
      return typeof c.templateName !== "string" || c.templateName === "";
    case "crm_etiqueta_add":
      return !Array.isArray(c.tagIds) || c.tagIds.length === 0;
    case "crm_etapa":
      return typeof c.etapaId !== "string" || c.etapaId === "";
    default:
      return false;
  }
}

/**
 * Los bloques de cada plantilla que el motor todavía no ejecuta. Una plantilla
 * con uno de estos no se puede publicar tal cual: el validador lo rechaza
 * nombrándolo, y quien la usa tiene que sacarlo. Se listan acá para que sea
 * una decisión a la vista y no un error que aparece al publicar.
 */
const NO_DISPONIBLES_POR_PLANTILLA: Record<string, NodoTipo[]> = {};

const CAMINOS: Record<string, NodoTipo[]> = {
  "responder-automatico": ["trigger_mensaje", "logica_condicion", "msg_texto", "logica_detener"],
  "etiquetar-automatico": [
    "trigger_mensaje",
    "logica_condicion",
    "crm_etiqueta_add",
    "logica_detener",
  ],
  "escalar-a-humano": [
    "trigger_mensaje",
    "logica_condicion",
    "crm_escalar_humano",
    "logica_detener",
  ],
  "reactivar-perdidos": [
    "trigger_cron",
    "logica_condicion",
    "msg_plantilla",
    "crm_etiqueta_add",
    "logica_detener",
  ],
  "bienvenida-agente": ["trigger_lead_creado", "msg_texto", "logica_detener"],
  "seguimiento-cotizacion": [
    "trigger_etapa",
    "logica_esperar",
    "logica_condicion",
    "msg_plantilla",
    "logica_esperar",
    "logica_condicion",
    "crm_escalar_humano",
    "logica_detener",
  ],
};

describe("armarPlantilla", () => {
  it("arma las seis plantillas de la galería, sin que sobre ni falte ninguna", () => {
    expect(PLANTILLAS.map((p) => p.id).sort()).toEqual(Object.keys(CAMINOS).sort());
    for (const p of PLANTILLAS) expect(armarPlantilla(p.id)).not.toBeNull();
  });

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s pasa la misma validación que Guardar: forma y sentido",
    (id) => {
      const { grafo } = armado(id);
      expect(GrafoSchema.safeParse(grafo).success).toBe(true);
      expect(validarGrafo(grafo)).toEqual([]);
    },
  );

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s pasa el validador de publicación en todo lo que no queda por elegir",
    (id) => {
      // Lo que la plantilla deja para completar (`pendiente`) lo marca el
      // validador, y está bien. Cualquier otro problema es un valor precargado
      // que no se puede publicar: una plantilla que nace rota.
      const { grafo } = armado(id);
      const marcados = NO_DISPONIBLES_POR_PLANTILLA[id] ?? [];
      const noPendientes = problemasParaPublicar(grafo).filter((p) => {
        const n = p.nodoId === null ? undefined : grafo.nodos.find((x) => x.id === p.nodoId);
        return n === undefined || (!leFaltaAlgo(n) && !marcados.includes(n.tipo));
      });
      expect(noPendientes).toEqual([]);
    },
  );

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s: sus bloques no disponibles son exactamente los marcados",
    (id) => {
      const { grafo } = armado(id);
      const noDisponibles = [
        ...new Set(
          grafo.nodos.filter((n) => !disponibilidadDeTipo(n.tipo).disponible).map((n) => n.tipo),
        ),
      ];
      expect(noDisponibles.sort()).toEqual([...(NO_DISPONIBLES_POR_PLANTILLA[id] ?? [])].sort());
    },
  );

  it.each(Object.entries(CAMINOS))("%s sigue los pasos de su tarjeta", (id, esperado) => {
    expect(caminoPrincipal(armado(id).grafo)).toEqual(esperado);
  });

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s: el «No» de cada condición termina el flujo, no lo deja colgado",
    (id) => {
      const { grafo } = armado(id);
      for (const c of grafo.nodos.filter((n) => esCondicion(n.tipo))) {
        const destino = grafo.aristas.find((a) => a.desde === c.id && a.puerto === "falso");
        expect(destino).toBeDefined();
        expect(nodoPorId(grafo, destino!.hasta).tipo).toBe("logica_detener");
      }
    },
  );

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s numera los nodos n1…nN, para que el próximo bloque del editor siga la cuenta",
    (id) => {
      const { grafo } = armado(id);
      expect(grafo.nodos.map((n) => n.id)).toEqual(grafo.nodos.map((_, i) => `n${i + 1}`));
    },
  );

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s cae sobre la grilla de 16 px del lienzo y ningún nodo pisa a otro",
    (id) => {
      const { grafo } = armado(id);
      for (const n of grafo.nodos) {
        expect(n.posicion.x % 16).toBe(0);
        expect(n.posicion.y % 16).toBe(0);
      }
      // Dos nodos no se pisan si están separados por al menos un ancho de nodo
      // más un paso de grilla en horizontal, o por una fila entera en vertical.
      for (const [i, a] of grafo.nodos.entries()) {
        for (const b of grafo.nodos.slice(i + 1)) {
          const dx = Math.abs(a.posicion.x - b.posicion.x);
          const dy = Math.abs(a.posicion.y - b.posicion.y);
          expect(dx >= MEDIDAS.NODO_ANCHO + 16 || dy >= 144).toBe(true);
        }
      }
    },
  );

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s avisa lo que queda por elegir si y sólo si a algún bloque le falta algo",
    (id) => {
      const { grafo, pendiente } = armado(id);
      expect(pendiente !== null).toBe(grafo.nodos.some(leFaltaAlgo));
    },
  );

  it("los valores precargados son opciones que los selectores del panel saben mostrar", () => {
    for (const p of PLANTILLAS) {
      for (const n of armado(p.id).grafo.nodos) {
        const c = n.config;
        if (typeof c.etapaId === "string") expect(ETAPAS_EMBUDO).toContain(c.etapaId);
        if (typeof c.etapaDestino === "string") expect(CURRENT_STAGE).toContain(c.etapaDestino);
        if (typeof c.campo === "string") expect(CAMPOS_CONDICION).toContain(c.campo);
        if (typeof c.operador === "string") expect(OPERADORES).toContain(c.operador);
      }
    }
  });

  it("seguimiento de cotización espera lo que dice la tarjeta: 24 horas y 48 más", () => {
    const { grafo } = armado("seguimiento-cotizacion");
    const esperas = grafo.nodos.filter((n) => n.tipo === "logica_esperar").map((n) => n.config);
    expect(esperas).toEqual([
      { duracion: 24, unidad: "horas" },
      { duracion: 48, unidad: "horas" },
    ]);
    expect(nodoPorId(grafo, "n1").config).toEqual({ etapaDestino: "cotizado" });
    // Un flujo no cierra una venta: tras 72 h sin respuesta se la pasa a una
    // persona, que decide si se perdió.
    expect(grafo.nodos.some((n) => n.tipo === "crm_etapa")).toBe(false);
    expect(nodoPorId(grafo, "n7").tipo).toBe("crm_escalar_humano");
  });

  it("escalar a humano usa el bloque de escalado, no «cambiar etapa»", () => {
    const { grafo } = armado("escalar-a-humano");
    expect(grafo.nodos.some((n) => n.tipo === "crm_etapa")).toBe(false);
    // El bloque del canvas, con formulario, y no el nodo legacy `accion` que
    // el panel mostraba como "Acción" y sin configuración.
    expect(nodoPorId(grafo, "n3").tipo).toBe("crm_escalar_humano");
  });

  it("reactivar perdidos corre los lunes a las 9:00 y sólo sobre leads perdidos", () => {
    const { grafo } = armado("reactivar-perdidos");
    // `dias` es el índice del selector de ConfigTrigger, que arranca en lunes.
    expect(nodoPorId(grafo, "n1").config).toEqual({
      frecuencia: "semanal",
      hora: "09:00",
      dias: [0],
    });
    expect(nodoPorId(grafo, "n2").config).toEqual({
      campo: "lead.etapa",
      operador: "es",
      valor: "perdido",
    });
  });

  it("bienvenida trae el saludo escrito, así que no queda nada obligatorio", () => {
    const { grafo, pendiente } = armado("bienvenida-agente");
    const saludo = grafo.nodos.find((n) => n.tipo === "msg_texto");
    expect(typeof saludo?.config.mensaje).toBe("string");
    expect(pendiente).toBeNull();
  });

  it("cada llamada devuelve un grafo nuevo: modificar uno no contamina al siguiente", () => {
    const primero = armado("responder-automatico");
    primero.grafo.nodos[0]!.config.tocado = true;
    primero.grafo.aristas.pop();

    const segundo = armado("responder-automatico");
    expect(segundo.grafo.nodos[0]!.config).toEqual({});
    expect(validarGrafo(segundo.grafo)).toEqual([]);
  });

  it.each(["en-blanco", "no-existe", "", "constructor", "__proto__", "toString"])(
    "«%s» no es una plantilla: devuelve null y no un objeto heredado",
    (id) => {
      expect(armarPlantilla(id)).toBeNull();
    },
  );

  it.each(PLANTILLAS.map((p) => p.id))(
    "%s: ningún bloque del lienzo queda sin ejecutar, así que se puede publicar una vez completo",
    (id) => {
      expect(bloquesQueNoCorren(armado(id).grafo)).toEqual([]);
    },
  );
});

describe("bloquesQueNoCorren", () => {
  it("nombra los bloques que el motor no ejecuta, una vez cada uno, como se leen en el lienzo", () => {
    const g: Grafo = {
      nodos: [
        { id: "n1", tipo: "trigger_mensaje", config: {}, posicion: { x: 0, y: 0 } },
        { id: "n2", tipo: "int_notif_vendedor", config: {}, posicion: { x: 0, y: 144 } },
        { id: "n3", tipo: "int_notif_vendedor", config: {}, posicion: { x: 0, y: 288 } },
        { id: "n4", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 432 } },
      ],
      aristas: [],
    };
    expect(bloquesQueNoCorren(g)).toEqual(["Notificar vendedor"]);
  });
});

describe("las tarjetas de la galería no prometen lo que el lienzo no arma", () => {
  const tarjeta = (id: string) => PLANTILLAS.find((p) => p.id === id)!;
  const texto = (id: string) => {
    const t = tarjeta(id);
    return [t.nombre, t.descripcion, t.disparador, ...t.pasos].join(" ").toLowerCase();
  };

  it("bienvenida no promete delegar al agente, esperar respuesta ni guardar el vehículo", () => {
    const t = texto("bienvenida-agente");
    expect(t).not.toMatch(/delega|agente|esperar la respuesta|guardar el vehículo/);
    expect(caminoPrincipal(armado("bienvenida-agente").grafo)).not.toContain("ia_delegar");
  });

  it("responder automático no promete clasificar, buscar reglas ni pasar al agente", () => {
    expect(texto("responder-automatico")).not.toMatch(/clasific|regla|agente|modelo/);
  });

  it("escalar a humano no promete avisar al vendedor: no hay canal para hacerlo", () => {
    expect(texto("escalar-a-humano")).not.toMatch(/vendedor/);
  });

  it("reactivar perdidos no promete agrupar por motivo ni una plantilla por motivo", () => {
    expect(texto("reactivar-perdidos")).not.toMatch(/motivo/);
  });
});
