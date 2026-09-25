import { ETIQUETA_NODO } from "@/lib/workflows/catalogo";
import { disponibilidadDeTipo } from "@/lib/workflows/disponibilidad";
import { CATEGORIAS_NODOS } from "@/lib/workflows/nodos-catalogo";
import { puertosDe } from "@/lib/workflows/validar-grafo";
import {
  categoriaDeTipo,
  esCondicion,
  esTrigger,
  type CategoriaVisual,
  type Grafo,
  type Nodo,
  type NodoTipo,
  type Puerto,
} from "@/types/workflows";
import { resumenDeConfigCondicion } from "./campos-condicion";

import type { SalidaNodo } from "@/components/workflows/canvas/nodos/NodoBase";
import type {
  CategoriaBloques,
  PresentacionNodo,
  ProblemaNombrado,
} from "@/components/workflows/editor";
import type { ProblemaPublicacion } from "@/lib/workflows/validar-workflow";

/**
 * Cómo se presenta un nodo del dominio en los tres lienzos del flujo: el
 * editor, el diff de publicación y la corrida.
 *
 * Los tres componentes son presentación pura y reciben esto como
 * `ResolverNodo`: ninguno importa el catálogo de los 57 tipos. Que la
 * traducción viva en un solo lugar es lo que hace que el mismo nodo se llame
 * igual, tenga el mismo color y las mismas salidas en las tres pantallas — la
 * corrida se reconoce porque es el mismo dibujo que se editó.
 */

interface InfoTipo {
  nombre: string;
  descripcion: string;
  icono: CategoriaBloques["bloques"][number]["icono"];
}

/** Tipo de nodo → cómo se llama y qué hace, según el catálogo de los 57. */
const CATALOGO: ReadonlyMap<string, InfoTipo> = new Map(
  CATEGORIAS_NODOS.flatMap((c) =>
    c.nodos.map(
      (n) => [n.tipo, { nombre: n.nombre, descripcion: n.descripcion, icono: n.icono }] as const,
    ),
  ),
);

/**
 * Categoría visual de los 5 tipos legacy, que `categoriaDeTipo` devuelve como
 * `null`. Los valores replican el mapeo que ya usa `canvas/nodos/index.ts`
 * (`disparador → NodoTrigger`, `accion → NodoMensajeria`, el resto → NodoLogica):
 * elegir otro acá haría que el mismo grafo se pintara de dos colores según qué
 * lienzo lo abra.
 */
const CATEGORIA_LEGACY: Readonly<Record<string, CategoriaVisual>> = {
  disparador: "trigger",
  accion: "mensajeria",
  condicion: "logica",
  espera: "logica",
  fin: "logica",
};

/**
 * Las claves de config de la condición, en el idioma de quien la armó. Las usan
 * el aviso "sin publicar" del editor y el diff de publicación, para que los dos
 * nombren el cambio igual. Una clave sin traducción sale tal cual.
 */
export const ETIQUETAS_CONFIG: Readonly<Record<string, string>> = {
  arbol: "Condición",
  campo: "Campo",
  operador: "Operador",
  valor: "Valor",
};

/** Cómo se rotula cada puerto en el chip del nodo y en la etiqueta de la línea. */
export const ETIQUETA_PUERTO: Readonly<Record<Puerto, string>> = {
  salida: "",
  verdadero: "Sí",
  falso: "No",
};

/**
 * Las salidas de un nodo, en el idioma de `NodoBase`.
 *
 * `undefined` = un único puerto centrado y sin chip (el caso de 55 de los 57
 * tipos). `[]` = terminal, sin conector abajo. Un array con dos = una condición.
 */
export function salidasDe(tipo: NodoTipo): SalidaNodo[] | undefined {
  const puertos = puertosDe(tipo);
  if (puertos.length === 1 && puertos[0] === "salida") return undefined;
  return puertos.map((p) => ({ id: p, label: ETIQUETA_PUERTO[p] }));
}

/**
 * El nombre de un tipo de nodo.
 *
 * `CATEGORIAS_NODOS` es la paleta y sólo tiene los 57 tipos nuevos: los 5
 * legacy no están, y sin el segundo escalón el lienzo los rotulaba con el
 * identificador crudo. `ETIQUETA_NODO` sí los tiene, y es el mismo mapa que usa
 * la línea de tiempo del historial.
 */
export function nombreDeTipo(tipo: NodoTipo): string {
  return CATALOGO.get(tipo)?.nombre ?? ETIQUETA_NODO[tipo] ?? tipo;
}

/**
 * El resumen del nodo.
 *
 * Para la condición, la frase que arma su árbol ("Etapa es Cotizado y…"): es
 * lo único que distingue dos condiciones en el lienzo, y lo que el diff y la
 * corrida necesitan para que se sepa cuál es cuál. Para el resto, la
 * descripción del catálogo — escribir una frase con los valores de `config`
 * para los 57 tipos es una pieza de presentación que todavía no existe.
 */
export function resumenDe(nodo: Pick<Nodo, "tipo" | "config">): string | undefined {
  if (esCondicion(nodo.tipo)) {
    const frase = resumenDeConfigCondicion(nodo.config);
    if (frase) return frase;
  }
  return CATALOGO.get(nodo.tipo)?.descripcion;
}

/**
 * Los errores que impiden publicar, con el nodo nombrado como se lee en el
 * lienzo. El servicio los devuelve por id, que nadie ve; el nombre del tipo
 * solo no alcanza cuando hay dos "Enviar texto", así que los repetidos se
 * numeran en el orden en que se leen: de arriba abajo, y de izquierda a
 * derecha en la misma altura.
 */
export function problemasConNombre(
  grafo: Grafo,
  problemas: readonly ProblemaPublicacion[],
): ProblemaNombrado[] {
  const nombres = new Map<string, string>();
  const porTipo = new Map<NodoTipo, Nodo[]>();
  for (const n of grafo.nodos) porTipo.set(n.tipo, [...(porTipo.get(n.tipo) ?? []), n]);
  for (const [tipo, nodos] of porTipo) {
    const nombre = nombreDeTipo(tipo);
    if (nodos.length === 1) {
      nombres.set(nodos[0]!.id, nombre);
      continue;
    }
    const enOrden = [...nodos].sort(
      (a, b) => a.posicion.y - b.posicion.y || a.posicion.x - b.posicion.x,
    );
    enOrden.forEach((n, i) => nombres.set(n.id, `${nombre} ${i + 1}`));
  }

  return problemas.map((p) => ({
    nodo: p.nodoId === null ? "Flujo" : (nombres.get(p.nodoId) ?? p.nodoId),
    mensaje: p.mensaje,
  }));
}

export function presentacionDe(nodo: Nodo): PresentacionNodo {
  return {
    nombre: nombreDeTipo(nodo.tipo),
    categoria: categoriaDeTipo(nodo.tipo) ?? CATEGORIA_LEGACY[nodo.tipo] ?? "interno",
    icono: CATALOGO.get(nodo.tipo)?.icono,
    resumen: resumenDe(nodo),
    salidas: salidasDe(nodo.tipo),
    sinEntrada: esTrigger(nodo.tipo),
  };
}

/**
 * Las 7 categorías de la paleta. Los bloques que el motor no ejecuta salen
 * atenuados con su motivo (`disponibilidad.ts`): se ven —así nadie los busca
 * tres veces— pero no se pueden arrastrar, y el validador tampoco dejaría
 * publicarlos.
 *
 * Armada una sola vez: sin disparador puesto es siempre la misma referencia,
 * que es lo que deja al `useMemo` del editor no repintar la paleta.
 */
const CATEGORIAS_PALETA: readonly CategoriaBloques[] = CATEGORIAS_NODOS.map((c) => ({
  id: c.id,
  nombre: c.nombre,
  color: c.color,
  bloques: c.nodos.map((n) => {
    const d = disponibilidadDeTipo(n.tipo as NodoTipo);
    return {
      tipo: n.tipo,
      nombre: n.nombre,
      descripcion: n.descripcion,
      icono: n.icono,
      ...(d.disponible ? {} : { motivoNoAplica: d.motivo }),
    };
  }),
}));

/**
 * La paleta para el flujo abierto. Con un disparador puesto, los demás
 * disparadores tampoco aplican —un flujo tiene uno solo (`disparador_unico`)—;
 * el que ya no se podía ejecutar conserva su motivo, que es el más de fondo.
 */
export function categoriasDePaleta(disparadorActual?: string): readonly CategoriaBloques[] {
  if (!disparadorActual) return CATEGORIAS_PALETA;
  const motivo = `Este flujo ya arranca con «${disparadorActual}», y un flujo tiene un solo disparador.`;
  return CATEGORIAS_PALETA.map((c) =>
    c.id !== "triggers"
      ? c
      : {
          ...c,
          bloques: c.bloques.map((b) => ({ ...b, motivoNoAplica: b.motivoNoAplica ?? motivo })),
        },
  );
}
