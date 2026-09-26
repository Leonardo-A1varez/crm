import {
  esTrigger,
  type Arista,
  type Grafo,
  type Nodo,
  type NodoTipo,
  type Puerto,
} from "@/types/workflows";
import { puertosDeNodo } from "./validar-grafo";

/**
 * Los arreglos de un clic del editor de flujos.
 *
 * Cada arreglo es una transformación pura de un `Grafo` a otro: no dibuja nada
 * y no sabe de React Flow. El editor la aplica y vuelve a validar con
 * `validarGrafo`, así que un arreglo que no arregla se ve igual que antes: el
 * rojo sigue ahí. Sólo existen los arreglos que tienen una respuesta correcta
 * sin preguntarle nada a nadie; lo que depende del negocio (qué etiqueta, qué
 * texto) no tiene arreglo automático y el editor sólo lo explica.
 */
export type Arreglo =
  /** Agrega un «Detener» debajo del nodo y lo conecta por `puerto`. */
  | { tipo: "agregar_detener"; desde: string; puerto: Puerto }
  /** Conecta `puerto` de `desde` a un nodo que ya existe. */
  | { tipo: "conectar"; desde: string; puerto: Puerto; hasta: string }
  /** Saca las líneas que vuelven al disparador (`disparador_sin_entrantes`). */
  | { tipo: "soltar_aristas_al_disparador"; disparadorId: string }
  /** Saca las líneas que apuntan a un paso que no existe (`arista_a_nodo_inexistente`). */
  | { tipo: "soltar_aristas_colgadas" }
  /** Borra el bloque y cose la línea, igual que el botón de borrar del lienzo. */
  | { tipo: "quitar_nodo"; nodoId: string };

export interface ResultadoArreglo {
  grafo: Grafo;
  /** El id del nodo que el arreglo creó, si creó uno. */
  nodoNuevo?: string;
}

/** Medidas del lienzo: filas de 144 y columnas de 288, múltiplos de la grilla de 16. */
const FILA = 144;
const COLUMNA = 288;
const GRILLA = 16;
/** Ancho de un nodo más un paso de grilla: menos que esto en x y en y es pisarse. */
const SEPARACION_X = 200 + GRILLA;

/** Primer id libre de la forma `n1`, `n2`… Es la cuenta que sigue el editor. */
export function proximoIdNodo(ids: Iterable<string>): string {
  const usados = new Set(ids);
  let i = 1;
  while (usados.has(`n${i}`)) i += 1;
  return `n${i}`;
}

function alGrilla(v: number): number {
  return Math.round(v / GRILLA) * GRILLA;
}

function mismaArista(a: Arista, b: Arista): boolean {
  return a.desde === b.desde && a.hasta === b.hasta && a.puerto === b.puerto;
}

/** Los puertos de un nodo que no llevan a ningún lado. */
export function salidasSueltas(grafo: Grafo, nodoId: string): Puerto[] {
  const nodo = grafo.nodos.find((n) => n.id === nodoId);
  if (!nodo) return [];
  return puertosDeNodo(nodo).filter(
    (p) => !grafo.aristas.some((a) => a.desde === nodoId && a.puerto === p),
  );
}

/**
 * A qué nodos se puede conectar una salida de `nodoId`: todos salvo el mismo
 * nodo y los disparadores (`disparador_sin_entrantes`).
 */
export function destinosPosibles(grafo: Grafo, nodoId: string): Nodo[] {
  return grafo.nodos.filter((n) => n.id !== nodoId && !esTrigger(n.tipo));
}

/** Un lugar libre cerca de `deseada`, corriéndose a la derecha de a una columna. */
function posicionLibre(grafo: Grafo, deseada: { x: number; y: number }): { x: number; y: number } {
  const pisa = (p: { x: number; y: number }) =>
    grafo.nodos.some(
      (n) => Math.abs(n.posicion.x - p.x) < SEPARACION_X && Math.abs(n.posicion.y - p.y) < FILA,
    );
  let p = { x: alGrilla(deseada.x), y: alGrilla(deseada.y) };
  // Tope de vueltas: un lienzo de 200 nodos no llena 200 columnas en una fila.
  for (let i = 0; i < 200 && pisa(p); i += 1) p = { x: p.x + COLUMNA, y: p.y };
  return p;
}

/**
 * Agrega un bloque. Con `desde`, lo deja conectado al puerto del que salió el
 * cable; si ese nodo no existe o no tiene ese puerto, no inventa la línea.
 */
export function agregarNodo(
  grafo: Grafo,
  input: {
    tipo: NodoTipo;
    posicion: { x: number; y: number };
    desde?: { nodoId: string; puerto: Puerto };
  },
): { grafo: Grafo; id: string } {
  const id = proximoIdNodo(grafo.nodos.map((n) => n.id));
  const nodo: Nodo = { id, tipo: input.tipo, config: {}, posicion: { ...input.posicion } };
  const origen = input.desde ? grafo.nodos.find((n) => n.id === input.desde!.nodoId) : undefined;
  const conecta =
    input.desde !== undefined &&
    origen !== undefined &&
    puertosDeNodo(origen).includes(input.desde.puerto);
  return {
    id,
    grafo: {
      nodos: [...grafo.nodos, nodo],
      aristas: conecta
        ? [...grafo.aristas, { desde: input.desde!.nodoId, hasta: id, puerto: input.desde!.puerto }]
        : [...grafo.aristas],
    },
  };
}

/**
 * Borra un nodo y cose la línea: cada línea que entraba pasa a apuntar al
 * primer sucesor, con su puerto de origen. Es la misma regla que el botón de
 * borrar del lienzo y su previsualización.
 */
export function quitarNodoCosiendo(grafo: Grafo, nodoId: string): Grafo {
  const sucesor = grafo.aristas.find((a) => a.desde === nodoId)?.hasta;
  const cosidas: Arista[] =
    sucesor === undefined
      ? []
      : grafo.aristas
          .filter((a) => a.hasta === nodoId && a.desde !== sucesor)
          .map((a) => ({ desde: a.desde, hasta: sucesor, puerto: a.puerto }));
  const quedan = grafo.aristas.filter((a) => a.desde !== nodoId && a.hasta !== nodoId);
  for (const c of cosidas) if (!quedan.some((a) => mismaArista(a, c))) quedan.push(c);
  return { nodos: grafo.nodos.filter((n) => n.id !== nodoId), aristas: quedan };
}

/** Aplica un arreglo. Nunca modifica el grafo que recibe. */
export function aplicarArreglo(grafo: Grafo, arreglo: Arreglo): ResultadoArreglo {
  switch (arreglo.tipo) {
    case "agregar_detener": {
      const origen = grafo.nodos.find((n) => n.id === arreglo.desde);
      if (!origen) return { grafo: { nodos: [...grafo.nodos], aristas: [...grafo.aristas] } };
      // El «No» de una condición va a la columna de la derecha, como en las
      // plantillas: así las líneas de los dos puertos no se cruzan.
      const deseada = {
        x: origen.posicion.x + (arreglo.puerto === "falso" ? COLUMNA : 0),
        y: origen.posicion.y + FILA,
      };
      const { grafo: g, id } = agregarNodo(grafo, {
        tipo: "logica_detener",
        posicion: posicionLibre(grafo, deseada),
        desde: { nodoId: arreglo.desde, puerto: arreglo.puerto },
      });
      return { grafo: g, nodoNuevo: id };
    }
    case "conectar": {
      const nueva: Arista = { desde: arreglo.desde, hasta: arreglo.hasta, puerto: arreglo.puerto };
      const existe = grafo.aristas.some((a) => mismaArista(a, nueva));
      return {
        grafo: {
          nodos: [...grafo.nodos],
          aristas: existe ? [...grafo.aristas] : [...grafo.aristas, nueva],
        },
      };
    }
    case "soltar_aristas_al_disparador":
      return {
        grafo: {
          nodos: [...grafo.nodos],
          aristas: grafo.aristas.filter((a) => a.hasta !== arreglo.disparadorId),
        },
      };
    case "soltar_aristas_colgadas": {
      const ids = new Set(grafo.nodos.map((n) => n.id));
      return {
        grafo: {
          nodos: [...grafo.nodos],
          aristas: grafo.aristas.filter((a) => ids.has(a.desde) && ids.has(a.hasta)),
        },
      };
    }
    case "quitar_nodo":
      return { grafo: quitarNodoCosiendo(grafo, arreglo.nodoId) };
  }
}
