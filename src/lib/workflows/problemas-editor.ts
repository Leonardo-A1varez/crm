import {
  esCondicion,
  esSwitch,
  type Grafo,
  type Puerto,
  type ReglaValidacion,
} from "@/types/workflows";
import { salidasSueltas, type Arreglo } from "./arreglos";
import { disponibilidadDeTipo } from "./disponibilidad";
import { etiquetaDePuerto, puertosDeNodo, validarGrafo } from "./validar-grafo";
import { validarConfigNodo } from "./validar-workflow";

/**
 * Los problemas que el editor cuelga de cada nodo, con la solución al lado.
 *
 * No detecta nada propio: la detección es de `validarGrafo` (lo que rechaza
 * Guardar) y de `validarConfigNodo` (lo que además rechaza Publicar). Lo que
 * agrega este módulo es la traducción a la pantalla: qué pasa en palabras del
 * que arma el flujo, cuál es la regla que lo resuelve y, sólo cuando hay una
 * respuesta correcta sin preguntar nada, el arreglo de un clic.
 */

export type ReglaEditor = ReglaValidacion | "configuracion" | "no_disponible";

export interface ArregloOfrecido {
  /** Verbo en infinitivo: lo que va a pasar al apretar. */
  etiqueta: string;
  arreglo: Arreglo;
}

export interface ProblemaEditor {
  nodoId: string;
  regla: ReglaEditor;
  /** Qué pasa, en una línea. */
  mensaje: string;
  /** Cómo se resuelve. */
  ayuda: string;
  /** Vacío = no hay arreglo automático correcto: sólo se explica. */
  arreglos: ArregloOfrecido[];
}

export interface ProblemasDelEditor {
  porNodo: ProblemaEditor[];
  /** Los que no tienen un nodo donde colgarse (un flujo sin disparador). */
  delFlujo: string[];
}

const AGREGAR_DETENER = "Agregar «Detener» y conectarlo";

function agregarDetener(desde: string, puerto: Puerto): ArregloOfrecido {
  return { etiqueta: AGREGAR_DETENER, arreglo: { tipo: "agregar_detener", desde, puerto } };
}

export function problemasDelEditor(grafo: Grafo): ProblemasDelEditor {
  const porNodo: ProblemaEditor[] = [];
  const delFlujo: string[] = [];
  const existe = new Set(grafo.nodos.map((n) => n.id));
  /** Una sola entrada por nodo y regla: el validador reporta de a un puerto o de a un ciclo. */
  const vistos = new Set<string>();
  const primeraVez = (nodoId: string, regla: string) => {
    const clave = `${nodoId}|${regla}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  };

  for (const p of validarGrafo(grafo)) {
    switch (p.regla) {
      case "arista_a_nodo_inexistente": {
        // El validador nombra los ids que no existen. El problema se cuelga del
        // extremo que sí existe, que es donde se ve la línea rota.
        const faltan = new Set(p.nodos);
        const extremos = grafo.aristas
          .filter((a) => faltan.has(a.desde) || faltan.has(a.hasta))
          .flatMap((a) => [a.desde, a.hasta])
          .filter((id) => existe.has(id));
        for (const id of new Set(extremos)) {
          if (!primeraVez(id, p.regla)) continue;
          porNodo.push({
            nodoId: id,
            regla: p.regla,
            mensaje: "Hay una línea que sale de acá hacia un paso que ya no existe.",
            ayuda: "Una línea tiene que unir dos pasos del flujo. La que apunta al vacío se saca.",
            arreglos: [
              { etiqueta: "Sacar la línea rota", arreglo: { tipo: "soltar_aristas_colgadas" } },
            ],
          });
        }
        if (extremos.length === 0) delFlujo.push(p.mensaje);
        break;
      }
      case "disparador_unico": {
        if (p.nodos.length === 0) {
          delFlujo.push(p.mensaje);
          break;
        }
        for (const id of p.nodos) {
          if (!primeraVez(id, p.regla)) continue;
          porNodo.push({
            nodoId: id,
            regla: p.regla,
            mensaje: `El flujo tiene ${p.nodos.length} disparadores y no se sabe por cuál empieza.`,
            ayuda: "Un flujo arranca por un solo disparador: borrá los que sobran.",
            arreglos: [],
          });
        }
        break;
      }
      case "disparador_sin_entrantes": {
        const [disparadorId] = p.nodos;
        if (disparadorId === undefined) break;
        const arreglo: ArregloOfrecido = {
          etiqueta: "Sacar la línea que vuelve al inicio",
          arreglo: { tipo: "soltar_aristas_al_disparador", disparadorId },
        };
        for (const id of p.nodos) {
          if (!primeraVez(id, p.regla)) continue;
          porNodo.push({
            nodoId: id,
            regla: p.regla,
            mensaje:
              id === disparadorId
                ? "Una línea vuelve al disparador: el flujo se reiniciaría desde adentro."
                : "La línea que sale de acá vuelve al disparador.",
            ayuda: "Nada puede volver al disparador. Para repetir un tramo, usá una espera.",
            arreglos: [arreglo],
          });
        }
        break;
      }
      case "salida_sin_conectar": {
        const [id] = p.nodos;
        if (id === undefined || !primeraVez(id, p.regla)) break;
        porNodo.push({
          nodoId: id,
          regla: p.regla,
          mensaje: "La salida no está conectada: el flujo se cortaría acá sin decir nada.",
          ayuda: "Todo paso lleva a otro, salvo «Detener», que es el único que cierra un camino.",
          arreglos: salidasSueltas(grafo, id).map((puerto) => agregarDetener(id, puerto)),
        });
        break;
      }
      case "condicion_puertos": {
        const [id] = p.nodos;
        if (id === undefined || !primeraVez(id, p.regla)) break;
        const nodo = grafo.nodos.find((n) => n.id === id);
        if (!nodo) break;
        const esDeCasos = esSwitch(nodo.tipo);
        const puertos = puertosDeNodo(nodo);
        // Se recorre el nodo entero una vez: el validador da un problema por
        // puerto, y acá cada puerto necesita su propio mensaje y arreglo.
        for (const puerto of puertos) {
          const cuantas = grafo.aristas.filter((a) => a.desde === id && a.puerto === puerto).length;
          const nombre = etiquetaDePuerto(nodo, puerto);
          if (cuantas === 0) {
            porNodo.push({
              nodoId: id,
              regla: p.regla,
              mensaje: `La salida «${nombre}» no lleva a ningún paso.`,
              ayuda: esDeCasos
                ? "Cada caso lleva a un paso, y «Otro» también: es por donde sigue lo que no coincide con ninguno."
                : "Una condición necesita un camino por «Sí» y otro por «No».",
              arreglos: [agregarDetener(id, puerto)],
            });
          } else if (cuantas > 1) {
            porNodo.push({
              nodoId: id,
              regla: p.regla,
              mensaje: `Hay ${cuantas} líneas por «${nombre}» y no se sabe cuál tomar.`,
              ayuda: `Dejá una sola línea por «${nombre}»: borrá la que sobra.`,
              arreglos: [],
            });
          }
        }
        // Una línea que sale por un caso borrado: ninguna corrida la toma.
        const sueltas = grafo.aristas.filter((a) => a.desde === id && !puertos.includes(a.puerto));
        if (sueltas.length > 0) {
          porNodo.push({
            nodoId: id,
            regla: p.regla,
            mensaje: "Sale una línea por un caso que ya no existe.",
            ayuda: "Borrá esa línea, o volvé a agregar el caso en el panel de la derecha.",
            arreglos: [],
          });
        }
        break;
      }
      case "ir_a_destino": {
        const [id] = p.nodos;
        if (id === undefined || !primeraVez(id, p.regla)) break;
        porNodo.push({
          nodoId: id,
          regla: p.regla,
          mensaje: p.mensaje.includes("ya no existe")
            ? "Salta a un paso que ya no existe."
            : "No dice a qué paso ir.",
          ayuda: "Elegí en el panel de la derecha a qué paso del flujo salta.",
          arreglos: [],
        });
        break;
      }
      case "nodo_inalcanzable": {
        for (const id of p.nodos) {
          if (!primeraVez(id, p.regla)) continue;
          porNodo.push({
            nodoId: id,
            regla: p.regla,
            mensaje: "Este paso no se alcanza nunca desde el disparador.",
            ayuda: "Conectá una línea que llegue hasta acá desde otro paso del flujo, o borralo.",
            arreglos: [],
          });
        }
        break;
      }
      case "ciclo_sin_espera": {
        for (const id of p.nodos) {
          if (!primeraVez(id, p.regla)) continue;
          porNodo.push({
            nodoId: id,
            regla: p.regla,
            mensaje: "Este paso está en un ciclo sin ninguna espera: giraría sin freno.",
            ayuda: "Agregá una espera adentro del ciclo, en el tramo que se repite.",
            arreglos: [],
          });
        }
        break;
      }
    }
  }

  for (const nodo of grafo.nodos) {
    const noCorre = !disponibilidadDeTipo(nodo.tipo).disponible;
    for (const e of validarConfigNodo(nodo)) {
      if (e.tipo !== "error") continue;
      porNodo.push(
        noCorre
          ? {
              nodoId: nodo.id,
              regla: "no_disponible",
              mensaje: e.mensaje,
              ayuda:
                e.sugerencia ??
                "Sacá el bloque del flujo para poder publicarlo. La línea se cose sola.",
              arreglos: [
                { etiqueta: "Quitar el bloque", arreglo: { tipo: "quitar_nodo", nodoId: nodo.id } },
              ],
            }
          : {
              nodoId: nodo.id,
              regla: "configuracion",
              mensaje: e.mensaje,
              ayuda: esCondicion(nodo.tipo)
                ? "Armá la condición en el panel de la derecha."
                : "Completalo en el panel de la derecha.",
              arreglos: [],
            },
      );
    }
  }

  // Todo problema cuelga de un nodo que está en el lienzo: los ids que no
  // existen (una línea rota) ya se colgaron de su extremo existente.
  return { porNodo: porNodo.filter((p) => existe.has(p.nodoId)), delFlujo };
}

/**
 * Lo que hace el botón «Resolver» de un nodo: el primer arreglo de cada uno
 * de sus problemas. Vacío = nada de lo que tiene se resuelve solo.
 *
 * Nunca incluye borrar el bloque: «Resolver» agrega y conecta, y quitar un
 * bloque es una decisión que queda en su propio botón, con su nombre.
 */
export function arreglosDeResolver(
  problemas: readonly ProblemaEditor[],
  nodoId: string,
): ArregloOfrecido[] {
  return problemas
    .filter((p) => p.nodoId === nodoId)
    .flatMap((p) => {
      const primero = p.arreglos[0];
      return primero && primero.arreglo.tipo !== "quitar_nodo" ? [primero] : [];
    });
}
