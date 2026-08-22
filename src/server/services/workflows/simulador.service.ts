import type { RegistroDeAcciones } from "./acciones/registro";
import { ejecutarSegmento, type PasoEjecutado } from "./ejecutor.service";
import { disparadorDe } from "@/lib/workflows/recorrer";
import type { Grafo } from "@/types/workflows";

export interface PasoSimulado {
  nodoId: string;
  orden: number;
  reloj: Date;
  accion: string | null;
  salida: Record<string, unknown> | null;
}

export interface ResultadoSimulacion {
  pasos: PasoSimulado[];
  desenlace: "fin" | "fallado" | "tope";
  error?: string;
  /** Cuántos mensajes le habría mandado al lead. El número que importa. */
  salientes: number;
}

export interface OpcionesSimulacion {
  maxPasos: number;
  desde: Date;
  contexto?: Record<string, unknown>;
}

/**
 * Corre el grafo entero sin tocar nada, adelantando un reloj virtual en cada
 * espera. Usa el MISMO `ejecutarSegmento` que producción — sólo cambia el
 * registro de acciones (anotan en vez de hacer) y el reloj. Una segunda
 * implementación se desincronizaría, que es cómo mueren los simuladores.
 *
 * Siempre termina: corre hasta `fin`, `fallado` o `maxPasos`.
 */
export async function simular(
  grafo: Grafo,
  opciones: OpcionesSimulacion,
): Promise<ResultadoSimulacion> {
  const pasos: PasoSimulado[] = [];
  let reloj = new Date(opciones.desde);
  let salientes = 0;

  // Implementa `RegistroDeAcciones` directo en vez de pasar por
  // `crearRegistro`. Dos razones, y la primera es dura:
  //
  //   1. `crearRegistro` construye `new Map(Object.entries(handlers))` desde
  //      el fix de prototype chain de la Task 4. Un `Proxy` que solo trapea
  //      `get`/`has` devuelve `[]` en `Object.entries` —el trap que hace
  //      falta es `ownKeys`, no `get`— asi que el Map saldria vacio y CADA
  //      accion tiraria `ValidationError`. Verificado:
  //          node -e "console.log(Object.entries(new Proxy({},{get:()=>1})))"
  //          []
  //   2. Aun sin ese choque, el simulador no necesita despachar por nombre:
  //      acepta cualquier accion a proposito, porque simula en vez de actuar.
  //      Pasar por el despachador solo para engañarlo es mas fragil.
  const registro: RegistroDeAcciones = {
    async ejecutar(nodo) {
      const accion = String(nodo.config["accion"] ?? "");
      if (accion === "enviar_mensaje") salientes += 1;
      return { puerto: "salida", salida: { simulado: accion } };
    },
  };

  let nodoActual = disparadorDe(grafo)?.id;
  let pasosPrevios = 0;
  let desenlace: ResultadoSimulacion["desenlace"] = "fin";
  let error: string | undefined;

  const onPaso = async (p: PasoEjecutado) => {
    const nodo = grafo.nodos.find((n) => n.id === p.nodoId);
    pasos.push({
      nodoId: p.nodoId,
      orden: p.orden,
      reloj: new Date(reloj),
      accion: (nodo?.config["accion"] as string | undefined) ?? null,
      salida: p.salida,
    });
    pasosPrevios = p.orden;
  };

  // Cada vuelta del while es un segmento: el arranque, o reanudar tras una
  // espera. El reloj no duerme, salta.
  while (nodoActual !== undefined) {
    const resultado = await ejecutarSegmento(
      {
        grafo,
        desdeNodo: nodoActual,
        contexto: opciones.contexto ?? {},
        leadId: "simulacion",
        runId: "simulacion",
        pasosPrevios,
        maxPasos: opciones.maxPasos,
      },
      { registro, ahora: () => reloj, onPaso },
    );

    if (resultado.tipo === "fin") {
      desenlace = "fin";
      break;
    }
    if (resultado.tipo === "fallado") {
      // Comparar contra el enum, no contra el texto de `error`: un reword del
      // mensaje (fix round 1 de Task 5, Important 1) no puede romper esta
      // rama en silencio.
      desenlace = resultado.motivo === "tope_pasos" ? "tope" : "fallado";
      error = resultado.error;
      break;
    }
    reloj = resultado.hasta;
    // reanudarEn y no siguienteNodo: el ejecutor ya decidio si se vuelve al
    // nodo siguiente (espera) o al mismo (accion diferida fuera de horario).
    nodoActual = resultado.reanudarEn;
  }

  return { pasos, desenlace, error, salientes };
}
