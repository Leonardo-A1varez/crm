import type { Arista, Grafo, Nodo, NodoTipo, ProblemaGrafo, Puerto } from "@/types/workflows";

/**
 * Qué puertos de salida tiene cada tipo de nodo. El validador lo usa para la
 * regla `salida_sin_conectar` y el canvas de W5 para dibujar los conectores.
 *
 * `fin` no tiene ninguno: es el único nodo que puede cerrar un camino, y por
 * eso un flujo que se corta en cualquier otro lado es un error y no una
 * decisión de diseño.
 */
export function puertosDe(tipo: NodoTipo): Puerto[] {
  if (tipo === "condicion") return ["verdadero", "falso"];
  if (tipo === "fin") return [];
  return ["salida"];
}

/**
 * Valida la coherencia del grafo. Devuelve **todos** los problemas, no el
 * primero: quien está armando un flujo quiere ver de una vez todo lo que le
 * falta, no corregir de a uno y volver a guardar siete veces.
 *
 * Lista vacía = grafo válido.
 */
export function validarGrafo(grafo: Grafo): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const porId = new Map<string, Nodo>(grafo.nodos.map((n) => [n.id, n]));

  // --- regla: arista_a_nodo_inexistente ---------------------------------
  // Va primero porque el resto de las reglas recorre el grafo, y una arista
  // colgada haría que ese recorrido tropiece con un nodo que no existe.
  const aristasValidas: Arista[] = [];
  for (const a of grafo.aristas) {
    const faltan = [a.desde, a.hasta].filter((id) => !porId.has(id));
    if (faltan.length > 0) {
      problemas.push({
        regla: "arista_a_nodo_inexistente",
        nodos: faltan,
        mensaje: `La conexión apunta a un paso que no existe: ${faltan.join(", ")}.`,
      });
      continue;
    }
    aristasValidas.push(a);
  }

  // --- regla: disparador_unico ------------------------------------------
  const disparadores = grafo.nodos.filter((n) => n.tipo === "disparador");
  if (disparadores.length !== 1) {
    problemas.push({
      regla: "disparador_unico",
      nodos: disparadores.map((n) => n.id),
      mensaje:
        disparadores.length === 0
          ? "El flujo no tiene disparador: nada lo va a arrancar."
          : `El flujo tiene ${disparadores.length} disparadores y no se sabe por cuál empieza.`,
    });
  }
  const disparador = disparadores.length === 1 ? disparadores[0] : undefined;

  // --- regla: disparador_sin_entrantes ----------------------------------
  // Una arista hacia el disparador es reiniciar el flujo desde adentro: un
  // ciclo disfrazado, y sin la espera que exige `ciclo_sin_espera`.
  if (disparador) {
    const entrantes = aristasValidas.filter((a) => a.hasta === disparador.id);
    if (entrantes.length > 0) {
      problemas.push({
        regla: "disparador_sin_entrantes",
        nodos: [disparador.id, ...entrantes.map((a) => a.desde)],
        mensaje: "Nada puede volver al disparador: para repetir hay que usar una espera.",
      });
    }
  }

  // --- regla: salida_sin_conectar ---------------------------------------
  const salientesPorNodo = new Map<string, Arista[]>();
  for (const a of aristasValidas) {
    const previas = salientesPorNodo.get(a.desde);
    if (previas) previas.push(a);
    else salientesPorNodo.set(a.desde, [a]);
  }
  for (const n of grafo.nodos) {
    const salientes = salientesPorNodo.get(n.id) ?? [];
    for (const puerto of puertosDe(n.tipo)) {
      if (!salientes.some((a) => a.puerto === puerto)) {
        problemas.push({
          regla: "salida_sin_conectar",
          nodos: [n.id],
          mensaje: `El paso "${n.id}" deja la salida «${puerto}» sin conectar: el flujo se cortaría ahí sin decir nada.`,
        });
      }
    }
  }

  // --- regla: condicion_puertos -----------------------------------------
  // `salida_sin_conectar` ya cubre el puerto faltante; acá lo que importa es
  // el duplicado, que es indeterminismo: dos caminos por la misma respuesta.
  for (const n of grafo.nodos) {
    if (n.tipo !== "condicion") continue;
    const salientes = salientesPorNodo.get(n.id) ?? [];
    for (const puerto of ["verdadero", "falso"] as const) {
      const cuantas = salientes.filter((a) => a.puerto === puerto).length;
      if (cuantas > 1) {
        problemas.push({
          regla: "condicion_puertos",
          nodos: [n.id],
          mensaje: `La condición "${n.id}" tiene ${cuantas} caminos por «${puerto}» y no se sabe cuál tomar.`,
        });
      }
      if (cuantas === 0) {
        problemas.push({
          regla: "condicion_puertos",
          nodos: [n.id],
          mensaje: `La condición "${n.id}" no tiene camino por «${puerto}».`,
        });
      }
    }
  }

  // --- regla: nodo_inalcanzable -----------------------------------------
  if (disparador) {
    const alcanzables = new Set<string>();
    const pila = [disparador.id];
    while (pila.length > 0) {
      const actual = pila.pop();
      if (actual === undefined || alcanzables.has(actual)) continue;
      alcanzables.add(actual);
      for (const a of salientesPorNodo.get(actual) ?? []) pila.push(a.hasta);
    }
    const huerfanos = grafo.nodos.filter((n) => !alcanzables.has(n.id)).map((n) => n.id);
    if (huerfanos.length > 0) {
      problemas.push({
        regla: "nodo_inalcanzable",
        nodos: huerfanos,
        mensaje: `Estos pasos no se alcanzan nunca desde el disparador: ${huerfanos.join(", ")}.`,
      });
    }
  }

  // --- regla: ciclo_sin_espera ------------------------------------------
  problemas.push(...ciclosSinEspera(grafo.nodos, salientesPorNodo, porId));

  return problemas;
}

/**
 * Todo ciclo tiene que contener al menos una espera.
 *
 * Es la capa estática que hace seguros los ciclos libres. Un ciclo con espera
 * es el caso real de negocio ("insistir cada 2 días hasta que conteste"); un
 * ciclo sin espera gira en milisegundos, consume el tope de pasos de la
 * corrida en menos de un segundo y no hace nada útil. La diferencia se puede
 * probar sin ejecutar nada, así que se prueba acá y no en runtime.
 *
 * DFS de tres colores: blanco (sin visitar), gris (en la pila actual), negro
 * (cerrado). Una arista hacia un gris cierra un ciclo, que se reconstruye
 * desde la pila.
 */
function ciclosSinEspera(
  nodos: Nodo[],
  salientesPorNodo: Map<string, Arista[]>,
  porId: Map<string, Nodo>,
): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const negro = new Set<string>();
  const gris = new Set<string>();
  const pila: string[] = [];
  // Un mismo ciclo se puede alcanzar por varios caminos; sin esto el mismo
  // problema se reportaría repetido.
  const reportados = new Set<string>();

  function visitar(id: string): void {
    gris.add(id);
    pila.push(id);

    for (const a of salientesPorNodo.get(id) ?? []) {
      if (gris.has(a.hasta)) {
        const desde = pila.indexOf(a.hasta);
        const ciclo = pila.slice(desde);
        const clave = [...ciclo].sort().join(">");
        if (!reportados.has(clave)) {
          reportados.add(clave);
          const tieneEspera = ciclo.some((n) => porId.get(n)?.tipo === "espera");
          if (!tieneEspera) {
            problemas.push({
              regla: "ciclo_sin_espera",
              nodos: ciclo,
              mensaje: `Este ciclo no tiene ninguna espera (${ciclo.join(" → ")}): giraría sin freno. Agregá una espera adentro del ciclo.`,
            });
          }
        }
      } else if (!negro.has(a.hasta)) {
        visitar(a.hasta);
      }
    }

    pila.pop();
    gris.delete(id);
    negro.add(id);
  }

  // Desde todos los nodos y no sólo desde el disparador: un ciclo entre
  // nodos inalcanzables sigue siendo un ciclo mal formado, y reportarlo
  // ayuda a quien está armando el flujo por partes.
  for (const n of nodos) {
    if (!negro.has(n.id)) visitar(n.id);
  }

  return problemas;
}
