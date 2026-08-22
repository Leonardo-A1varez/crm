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
    // `condicion` queda afuera: `condicion_puertos` cubre sus dos puertos con
    // un mensaje específico ("no tiene camino por «falso»"), y reportar acá
    // también daría dos errores para un solo defecto.
    if (n.tipo === "condicion") continue;
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
  // Dueña de los dos puertos de una condición: el duplicado (indeterminismo,
  // dos caminos por la misma respuesta) y el faltante. `salida_sin_conectar`
  // se salteó estos nodos a propósito porque el mensaje específico de acá
  // ("no tiene camino por «falso»") es más claro que el genérico.
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
  problemas.push(...ciclosSinEspera(grafo.nodos, salientesPorNodo));

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
 * La versión anterior recorría el grafo completo y descartaba, por cada
 * ciclo encontrado, si alguno de sus nodos era una espera. Eso falla: un
 * mismo back edge cierra distintos ciclos según qué camino lo alcanzó
 * primero, y un DFS clásico visita cada nodo una sola vez — el primer camino
 * que llega a un nodo decide para siempre por dónde no se vuelve a entrar
 * ("`else if (!negro.has(a.hasta))`"). Si ese primer camino pasaba por una
 * espera, el ciclo sin espera que compartía el mismo back edge nunca se
 * examinaba: el mismo grafo daba veredictos opuestos según el orden del
 * array de aristas.
 *
 * La pregunta correcta no es "enumerar todos los ciclos" (depende del
 * recorrido) sino "¿existe un ciclo?" (no depende de nada): se saca del
 * grafo a todos los nodos `espera` — junto con toda arista que los toque — y
 * se corre un DFS de ciclos común sobre lo que queda. Cualquier ciclo que
 * aparezca ahí es wait-free por construcción, porque no quedó ninguna espera
 * para ocultarlo.
 */
function ciclosSinEspera(nodos: Nodo[], salientesPorNodo: Map<string, Arista[]>): ProblemaGrafo[] {
  const sinEspera = nodos.filter((n) => n.tipo !== "espera");
  const idsSinEspera = new Set(sinEspera.map((n) => n.id));
  const salientesSubgrafo = new Map<string, Arista[]>();
  for (const id of idsSinEspera) {
    salientesSubgrafo.set(
      id,
      (salientesPorNodo.get(id) ?? []).filter((a) => idsSinEspera.has(a.hasta)),
    );
  }

  return detectarCiclos(
    sinEspera.map((n) => n.id),
    salientesSubgrafo,
  );
}

/** Un frame del DFS: qué nodo, cuáles son sus salientes y por cuál va. */
interface FrameDfs {
  id: string;
  salientes: Arista[];
  siguiente: number;
}

/**
 * DFS de ciclos de tres colores (blanco / gris en la pila actual / negro
 * cerrado) con **pila explícita**, no recursión: un grafo con una cadena
 * larga de miles de nodos no puede reventar el call stack de Node.
 *
 * Reporta un problema por cada arista que cierra un ciclo hacia un nodo
 * todavía gris. Dos ciclos disjuntos no comparten nodos, así que cada uno
 * arranca su propio DFS raíz en el `for` externo y ambos se reportan.
 */
function detectarCiclos(ids: string[], salientes: Map<string, Arista[]>): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const estado = new Map<string, "gris" | "negro">();
  const pila: string[] = [];
  const frames: FrameDfs[] = [];

  for (const raiz of ids) {
    if (estado.has(raiz)) continue;

    estado.set(raiz, "gris");
    pila.push(raiz);
    frames.push({ id: raiz, salientes: salientes.get(raiz) ?? [], siguiente: 0 });

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.siguiente >= frame.salientes.length) {
        frames.pop();
        pila.pop();
        estado.set(frame.id, "negro");
        continue;
      }

      const arista = frame.salientes[frame.siguiente]!;
      frame.siguiente++;

      const destino = estado.get(arista.hasta);
      if (destino === "gris") {
        const desde = pila.indexOf(arista.hasta);
        const ciclo = pila.slice(desde);
        problemas.push({
          regla: "ciclo_sin_espera",
          nodos: ciclo,
          mensaje: `Este ciclo no tiene ninguna espera (${ciclo.join(" → ")}): giraría sin freno. Agregá una espera adentro del ciclo.`,
        });
      } else if (destino !== "negro") {
        estado.set(arista.hasta, "gris");
        pila.push(arista.hasta);
        frames.push({
          id: arista.hasta,
          salientes: salientes.get(arista.hasta) ?? [],
          siguiente: 0,
        });
      }
    }
  }

  return problemas;
}
