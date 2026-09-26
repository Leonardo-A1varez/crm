/**
 * Las opciones de "Mensaje con botones" y "Mensaje de lista": cuáles son,
 * qué salida tiene cada una y cómo se rotula.
 *
 * Se leen del `config` crudo y no con el schema (`config-nodos.ts`): el editor
 * dibuja las salidas mientras alguien todavía está escribiendo, con un botón
 * sin texto o una lista a medio armar. Lo que no se puede publicar lo frena el
 * schema; lo que se dibuja es lo que hay. Una opción sin un id válido no tiene
 * línea: no hay a qué puerto atarla.
 */

import {
  ID_DE_OPCION,
  PUERTO_SIN_RESPUESTA,
  opcionDePuerto,
  puertoDeOpcion,
  type Nodo,
  type Puerto,
} from "@/types/workflows";

export interface OpcionInteractiva {
  id: string;
  titulo: string;
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function opcion(v: unknown, claveTitulo: string): OpcionInteractiva | null {
  if (!esObjeto(v)) return null;
  const id = v["id"];
  if (typeof id !== "string" || !ID_DE_OPCION.test(id)) return null;
  const titulo = v[claveTitulo];
  return { id, titulo: typeof titulo === "string" ? titulo : "" };
}

/**
 * Las opciones del nodo, en el orden en que se ven. `null` si el tipo no es
 * uno que espera una opción.
 */
export function opcionesDeNodo(nodo: Pick<Nodo, "tipo" | "config">): OpcionInteractiva[] | null {
  if (nodo.tipo === "msg_botones") {
    const botones = nodo.config["botones"];
    return Array.isArray(botones)
      ? botones.map((b) => opcion(b, "texto")).filter((o): o is OpcionInteractiva => o !== null)
      : [];
  }
  if (nodo.tipo === "msg_lista") {
    const secciones = nodo.config["secciones"];
    if (!Array.isArray(secciones)) return [];
    return secciones.flatMap((s) =>
      esObjeto(s) && Array.isArray(s["items"])
        ? s["items"]
            .map((i) => opcion(i, "titulo"))
            .filter((o): o is OpcionInteractiva => o !== null)
        : [],
    );
  }
  return null;
}

/** Los tipos que mandan opciones y esperan que el lead elija una. */
export function esperaOpcion(tipo: Nodo["tipo"]): boolean {
  return tipo === "msg_botones" || tipo === "msg_lista";
}

/**
 * Las salidas de un nodo que espera una opción: una por opción —sin repetir
 * ids: dos opciones con el mismo id serían una sola línea— y «sin respuesta»
 * al final. `null` si el tipo no espera una opción.
 */
export function puertosDeOpciones(nodo: Pick<Nodo, "tipo" | "config">): Puerto[] | null {
  const opciones = opcionesDeNodo(nodo);
  if (opciones === null) return null;
  const ids = [...new Set(opciones.map((o) => o.id))];
  return [...ids.map(puertoDeOpcion), PUERTO_SIN_RESPUESTA];
}

/**
 * Cómo se rotula una salida de un nodo con opciones: el texto de la opción
 * (o "Opción sin texto" mientras no lo tenga), y «Sin respuesta». `null` si el
 * puerto no es de opciones.
 */
export function etiquetaDePuertoDeOpcion(
  nodo: Pick<Nodo, "tipo" | "config">,
  puerto: string,
): string | null {
  if (puerto === PUERTO_SIN_RESPUESTA) return "Sin respuesta";
  const id = opcionDePuerto(puerto);
  if (id === null) return null;
  const titulo = opcionesDeNodo(nodo)
    ?.find((o) => o.id === id)
    ?.titulo.trim();
  return titulo ? titulo : "Opción sin texto";
}

/**
 * El id de una opción nueva: `op<n>`, con `n` uno más que el mayor en uso. No
 * rellena huecos: el id es la línea (`opcion:<id>`), y reciclar el de una
 * opción recién borrada ataría a la nueva la línea que alguien conectó para
 * la vieja.
 */
export function nuevoIdDeOpcion(existentes: readonly string[]): string {
  const mayor = existentes.reduce((m, id) => {
    const n = /^op(\d+)$/.exec(id)?.[1];
    return n === undefined ? m : Math.max(m, Number(n));
  }, 0);
  return `op${mayor + 1}`;
}
