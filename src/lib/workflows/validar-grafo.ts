import {
  ID_DE_CASO,
  casoDePuerto,
  esCondicion,
  esEspera,
  esFinal,
  esSalto,
  esSwitch,
  esTrigger,
  puertoDeCaso,
} from "@/types/workflows";
import type { Arista, Grafo, Nodo, NodoTipo, ProblemaGrafo, Puerto } from "@/types/workflows";
import { esperaOpcion, etiquetaDePuertoDeOpcion, puertosDeOpciones } from "./opciones-interactivas";

/**
 * Qué puertos de salida tiene cada tipo de nodo. El validador lo usa para la
 * regla `salida_sin_conectar` y el canvas de W5 para dibujar los conectores.
 *
 * Un nodo final (`fin`/`logica_detener`) no tiene ninguno: es el único que
 * puede cerrar un camino, y por eso un flujo que se corta en cualquier otro
 * lado es un error y no una decisión de diseño. "Ir a" tampoco: su salida es
 * el destino que eligió (`aristasDeSalto`).
 *
 * Los tipos cuyos puertos dependen de la config ("Según el valor", un puerto
 * por caso) dan acá sólo los fijos; los de un nodo concreto los da
 * `puertosDeNodo`.
 */
export function puertosDe(tipo: NodoTipo): Puerto[] {
  if (esCondicion(tipo)) return ["verdadero", "falso"];
  if (esFinal(tipo) || esSalto(tipo)) return [];
  if (esSwitch(tipo)) return ["otro"];
  // Botones y lista: una salida por opción (`puertosDeNodo`) y ésta.
  if (esperaOpcion(tipo)) return ["sin_respuesta"];
  return ["salida"];
}

/** Un caso de "Según el valor", tal como lo guarda el panel. */
export interface CasoSwitch {
  id: string;
  valor: string;
}

/**
 * Los casos de un "Según el valor" leídos de su config **sin validarla**: el
 * lienzo y el validador tienen que poder dibujar un switch a medio armar. Un
 * caso sin id usable no tiene puerto; un id repetido, uno solo. Que los
 * valores estén completos y no se repitan lo exige la config al publicar.
 */
export function casosDeSwitch(config: Record<string, unknown>): CasoSwitch[] {
  const casos = config["casos"];
  if (!Array.isArray(casos)) return [];
  const vistos = new Set<string>();
  const salida: CasoSwitch[] = [];
  for (const c of casos) {
    if (c === null || typeof c !== "object") continue;
    const { id, valor } = c as Record<string, unknown>;
    if (typeof id !== "string" || !ID_DE_CASO.test(id) || vistos.has(id)) continue;
    vistos.add(id);
    salida.push({ id, valor: typeof valor === "string" ? valor : "" });
  }
  return salida;
}

/**
 * Los puertos de un nodo concreto: los de su tipo y, en "Según el valor", uno
 * por caso —en el orden de los casos— antes de `otro`.
 */
export function puertosDeNodo(nodo: Pick<Nodo, "tipo" | "config">): Puerto[] {
  if (esSwitch(nodo.tipo)) {
    return [...casosDeSwitch(nodo.config).map((c) => puertoDeCaso(c.id)), "otro"];
  }
  return puertosDeOpciones(nodo) ?? puertosDe(nodo.tipo);
}

/**
 * Cómo se nombra un puerto frente a quien arma el flujo: en el chip del nodo,
 * en la línea y en los problemas. El de un caso es su valor.
 */
export function etiquetaDePuerto(nodo: Pick<Nodo, "tipo" | "config">, puerto: Puerto): string {
  switch (puerto) {
    case "salida":
      return "salida";
    case "verdadero":
      return "Sí";
    case "falso":
      return "No";
    case "otro":
      return "Otro";
    case "sin_respuesta":
      return "Sin respuesta";
  }
  const casoId = casoDePuerto(puerto);
  if (casoId !== null) {
    const caso = casosDeSwitch(nodo.config).find((c) => c.id === casoId);
    if (!caso) return "caso borrado";
    return caso.valor.trim() === "" ? "caso sin valor" : caso.valor.trim();
  }
  return etiquetaDePuertoDeOpcion(nodo, puerto) ?? puerto;
}

/** El paso al que salta un "Ir a", o `null` si todavía no eligió ninguno. */
export function destinoDeSalto(nodo: Pick<Nodo, "tipo" | "config">): string | null {
  if (!esSalto(nodo.tipo)) return null;
  const destino = nodo.config["nodoDestino"];
  return typeof destino === "string" && destino.trim() !== "" ? destino : null;
}

/**
 * Los saltos de los "Ir a" como líneas: `{ desde: el salto, hasta: su destino }`.
 * El validador las suma a las aristas para que un salto cuente igual que una
 * línea al decidir qué se alcanza, qué vuelve al disparador y qué cicla sin
 * espera. Sólo las de destino elegido; que exista lo mira `validarGrafo`.
 */
export function aristasDeSalto(grafo: Grafo): Arista[] {
  const aristas: Arista[] = [];
  for (const n of grafo.nodos) {
    const destino = destinoDeSalto(n);
    if (destino !== null) aristas.push({ desde: n.id, hasta: destino, puerto: "salida" });
  }
  return aristas;
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
  const disparadores = grafo.nodos.filter((n) => esTrigger(n.tipo));
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

  // --- regla: ir_a_destino ----------------------------------------------
  // Un "Ir a" sin destino, o con uno que ya no existe (se borró el paso), deja
  // el camino cortado igual que una salida sin conectar. Los que sí apuntan a
  // un paso cuentan desde acá como una línea más.
  const saltos: Arista[] = [];
  for (const salto of aristasDeSalto(grafo)) {
    if (porId.has(salto.hasta)) {
      saltos.push(salto);
      continue;
    }
    problemas.push({
      regla: "ir_a_destino",
      nodos: [salto.desde],
      mensaje: `El paso "${salto.desde}" salta a "${salto.hasta}", que ya no existe.`,
    });
  }
  for (const n of grafo.nodos) {
    if (esSalto(n.tipo) && destinoDeSalto(n) === null) {
      problemas.push({
        regla: "ir_a_destino",
        nodos: [n.id],
        mensaje: `El paso "${n.id}" no dice a qué paso ir.`,
      });
    }
  }
  const aristasConSaltos = [...aristasValidas, ...saltos];

  // --- regla: disparador_sin_entrantes ----------------------------------
  // Una arista hacia el disparador es reiniciar el flujo desde adentro: un
  // ciclo disfrazado, y sin la espera que exige `ciclo_sin_espera`.
  if (disparador) {
    const entrantes = aristasConSaltos.filter((a) => a.hasta === disparador.id);
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
  for (const a of aristasConSaltos) {
    const previas = salientesPorNodo.get(a.desde);
    if (previas) previas.push(a);
    else salientesPorNodo.set(a.desde, [a]);
  }
  for (const n of grafo.nodos) {
    // Las condiciones y los "Según el valor" quedan afuera: `condicion_puertos`
    // cubre sus puertos con un mensaje específico ("no tiene camino por
    // «falso»"), y reportar acá también daría dos errores para un solo defecto.
    if (esCondicion(n.tipo) || esSwitch(n.tipo)) continue;
    const salientes = salientesPorNodo.get(n.id) ?? [];
    for (const puerto of puertosDeNodo(n)) {
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
    if (!esCondicion(n.tipo)) continue;
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

  // Lo mismo para "Según el valor", con un puerto por caso más «Otro». Suma
  // una tercera falla que la condición no puede tener: una línea que sale por
  // un caso que ya se borró, y que ninguna corrida va a tomar.
  for (const n of grafo.nodos) {
    if (!esSwitch(n.tipo)) continue;
    const salientes = aristasValidas.filter((a) => a.desde === n.id);
    const puertos = puertosDeNodo(n);
    for (const puerto of puertos) {
      const cuantas = salientes.filter((a) => a.puerto === puerto).length;
      const nombre = etiquetaDePuerto(n, puerto);
      if (cuantas > 1) {
        problemas.push({
          regla: "condicion_puertos",
          nodos: [n.id],
          mensaje: `El paso "${n.id}" tiene ${cuantas} caminos por «${nombre}» y no se sabe cuál tomar.`,
        });
      }
      if (cuantas === 0) {
        problemas.push({
          regla: "condicion_puertos",
          nodos: [n.id],
          mensaje: `El paso "${n.id}" no tiene camino por «${nombre}».`,
        });
      }
    }
    const huerfanas = salientes.filter((a) => !puertos.includes(a.puerto));
    if (huerfanas.length > 0) {
      problemas.push({
        regla: "condicion_puertos",
        nodos: [n.id],
        mensaje: `Del paso "${n.id}" sale una línea por un caso que ya no existe.`,
      });
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
  const sinEspera = nodos.filter((n) => !esEspera(n.tipo));
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
