/**
 * Validación pre-publicación de workflows.
 *
 * Extiende `validar-grafo.ts` (estructura del grafo) con validaciones de
 * configuración de nodos: un grafo puede estar bien conectado pero tener un
 * nodo de mensaje sin mensaje escrito, que en ejecución tiraría error.
 *
 * Este archivo no reemplaza `validar-grafo.ts` — lo complementa. El camino de
 * guardar sólo valida estructura (basta con que el grafo no esté roto); el
 * camino de publicar exige estructura + configuración (tiene que poder correr).
 */

import { esCondicion, esTrigger } from "@/types/workflows";
import type { Grafo, Nodo, ProblemaGrafo } from "@/types/workflows";
import { ETIQUETA_NODO } from "./catalogo";
import { CondicionSchema } from "./condiciones.schema";
import { revisarConfig } from "./config-nodos";
import { disponibilidadDeTipo } from "./disponibilidad";
import { validarGrafo } from "./validar-grafo";

/** Error o advertencia de validación pre-publicación. */
export interface ErrorValidacion {
  tipo: "error" | "warning";
  /** Nodo involucrado, si aplica. */
  nodoId?: string;
  mensaje: string;
  sugerencia?: string;
}

/**
 * Valida un grafo para publicación. Devuelve errores y advertencias.
 *
 * Errores (`tipo: 'error'`) bloquean la publicación; advertencias no, pero hay
 * que mostrarlas para que quien publica sepa qué decidió dejar así.
 */
export function validarWorkflow(grafo: Grafo): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];

  // 1. Validaciones estructurales (del validador existente)
  const problemasGrafo = validarGrafo(grafo);
  for (const p of problemasGrafo) {
    errores.push({
      tipo: esErrorCritico(p) ? "error" : "warning",
      nodoId: p.nodos[0],
      mensaje: p.mensaje,
    });
  }

  // 2. Validar que haya exactamente un trigger
  const triggers = grafo.nodos.filter((n) => esTrigger(n.tipo));
  if (triggers.length === 0) {
    errores.push({
      tipo: "error",
      mensaje: "El workflow necesita un trigger para iniciar",
      sugerencia: "Arrastra un nodo trigger al canvas",
    });
  }
  if (triggers.length > 1) {
    errores.push({
      tipo: "error",
      nodoId: triggers[1]?.id,
      mensaje: "Solo puede haber un trigger por workflow",
      sugerencia: "Elimina los triggers extras",
    });
  }

  // 3. Validar configuración completa por tipo de nodo
  for (const nodo of grafo.nodos) {
    const erroresNodo = validarConfigNodo(nodo);
    for (const e of erroresNodo) {
      errores.push({
        ...e,
        nodoId: nodo.id,
      });
    }
  }

  // 4. Validar condiciones con ambas salidas conectadas
  const condiciones = grafo.nodos.filter(
    (n) => n.tipo === "logica_condicion" || n.tipo === "logica_switch",
  );
  for (const cond of condiciones) {
    const salidas = grafo.aristas.filter((a) => a.desde === cond.id);
    if (cond.tipo === "logica_condicion" && salidas.length < 2) {
      errores.push({
        tipo: "warning",
        nodoId: cond.id,
        mensaje: "La condición necesita conectar ambas salidas (Si/No)",
      });
    }
  }

  return errores;
}

/** Determina si un problema del grafo es crítico (error) o tolerable (warning). */
function esErrorCritico(problema: ProblemaGrafo): boolean {
  // Estos bloquean la ejecución
  const criticos = ["disparador_unico", "arista_a_nodo_inexistente", "condicion_puertos"];
  return criticos.includes(problema.regla);
}

/**
 * Valida la configuración de un nodo según su tipo.
 *
 * Qué claves mira, cuáles son obligatorias y con qué mensaje: todo sale del
 * contrato de `config-nodos.ts`, el mismo schema con que escribe el panel y
 * con que lee la acción. Antes este validador nombraba las claves por su
 * cuenta y pedía `tag_id` donde el panel guardaba `tagIds`: un bloque bien
 * configurado no se podía publicar.
 */
function validarConfigNodo(nodo: Nodo): ErrorValidacion[] {
  // Un bloque que el motor no ejecuta falla al correr, esté como esté
  // configurado. Pedirle además que complete sus campos sería mandar a quien
  // arma el flujo a llenar algo que no sirve de nada: se reporta sólo esto.
  const disponibilidad = disponibilidadDeTipo(nodo.tipo);
  if (!disponibilidad.disponible) {
    return [
      {
        tipo: "error",
        mensaje: `«${ETIQUETA_NODO[nodo.tipo] ?? nodo.tipo}» no se puede ejecutar: ${disponibilidad.motivo}`,
        sugerencia: "Sacá el bloque del flujo para poder publicarlo.",
      },
    ];
  }
  const revision = revisarConfig(nodo);
  if (revision === null) return validarCondicion(nodo);
  return [
    ...revision.errores.map((mensaje): ErrorValidacion => ({ tipo: "error", mensaje })),
    ...revision.advertencias.map(
      ({ mensaje, sugerencia }): ErrorValidacion => ({
        tipo: "warning",
        mensaje,
        ...(sugerencia ? { sugerencia } : {}),
      }),
    ),
  ];
}

/**
 * La condición queda fuera de `config-nodos.ts`: su config es el árbol Y/O del
 * constructor (`{ arbol }`) o, en flujos guardados antes, el trío plano
 * `{ campo, operador, valor }`. Se valida con `CondicionSchema`, el mismo
 * schema que corre el ejecutor antes de evaluar: acepta los dos formatos igual
 * que el motor y los mensajes son los mismos con que fallaría la corrida.
 *
 * Antes este chequeo exigía `campo`/`operador` sueltos, así que toda condición
 * armada con el constructor salía incompleta aunque estuviera bien.
 */
function validarCondicion(nodo: Nodo): ErrorValidacion[] {
  if (!esCondicion(nodo.tipo)) return [];
  const config = nodo.config;

  // La condición recién soltada: ni árbol ni campo. El mensaje de Zod para un
  // enum ausente ("campo: Invalid option…") no le dice nada a quien la armó.
  if (!Object.hasOwn(config, "arbol") && config["campo"] == null) {
    return [{ tipo: "error", mensaje: "Selecciona un campo para la condición" }];
  }

  const forma = CondicionSchema.safeParse(config);
  if (forma.success) return [];
  return forma.error.issues.map((i): ErrorValidacion => ({ tipo: "error", mensaje: i.message }));
}

/**
 * Agrupa errores por tipo para mostrar en la UI.
 */
export function agruparErrores(errores: ErrorValidacion[]): {
  criticos: ErrorValidacion[];
  advertencias: ErrorValidacion[];
} {
  return {
    criticos: errores.filter((e) => e.tipo === "error"),
    advertencias: errores.filter((e) => e.tipo === "warning"),
  };
}

/** Un error que impide publicar, sobre el nodo que lo tiene (`null` si es del flujo entero). */
export interface ProblemaPublicacion {
  nodoId: string | null;
  mensaje: string;
}

/**
 * Lo que impide publicar un grafo: los errores de `validarWorkflow`, sin las
 * advertencias. Lo usa el servicio antes de publicar o restaurar, y la
 * pantalla del diff para mostrarlos antes de que alguien apriete el botón.
 */
export function problemasParaPublicar(grafo: Grafo): ProblemaPublicacion[] {
  return validarWorkflow(grafo)
    .filter((e) => e.tipo === "error")
    .map((e) => ({ nodoId: e.nodoId ?? null, mensaje: e.mensaje }));
}

/**
 * Verifica si un workflow puede publicarse (sin errores críticos).
 */
export function puedePublicar(errores: ErrorValidacion[]): boolean {
  return errores.every((e) => e.tipo !== "error");
}
