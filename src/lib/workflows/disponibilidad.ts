/**
 * Qué bloques del editor se pueden ejecutar, y por qué no los demás.
 *
 * **Es la única respuesta del proyecto a esa pregunta.** La usan la paleta del
 * editor (atenúa lo que no corre, con el motivo), el validador de publicación
 * (rechaza un flujo con un bloque que no corre, nombrándolo) y, por el test de
 * `tests/unit/workflows/disponibilidad.test.ts`, el motor: ese test falla si un
 * tipo marcado como ejecutable no tiene handler en el registro de producción,
 * si uno marcado como no disponible sí lo tiene, o si aparece un tipo nuevo sin
 * que nadie decida de qué lado queda.
 *
 * Antes la paleta ofrecía los 57 bloques y el motor ejecutaba tres: un flujo con
 * "Asignar vendedor" se publicaba y fallaba recién al correr.
 *
 * Un bloque es ejecutable por una de tres vías, y ninguna se declara acá —se
 * deduce de donde vive el hecho—:
 * - **motor**: control de flujo que resuelve el ejecutor (condiciones, "Según
 *   el valor", "Ir a", esperas, finales);
 * - **disparador**: un trigger con emisor (`DISPARADOR_DE_TIPO`);
 * - **accion**: un tipo con acción del registro (`ACCION_DE_TIPO`).
 *
 * Lo que no entra en ninguna tiene que estar en `NO_DISPONIBLES` con el motivo.
 */

import {
  esCondicion,
  esEspera,
  esFinal,
  esSalto,
  esSwitch,
  esTrigger,
  type NodoTipo,
} from "@/types/workflows";
import { ACCION_DE_TIPO, DISPARADOR_DE_TIPO } from "./catalogo";

const TODAVIA_SIN_IA =
  "El motor todavía no llama a la IA desde un flujo: este bloque no tiene a quién pedirle el resultado.";

const DIFUSION_ES_DE_GRUPO =
  "El motor corre cada flujo para un lead, y este bloque trabaja sobre un grupo de destinatarios: no hay audiencia a la que aplicarlo. Las difusiones se arman y se mandan desde la pantalla Difusión.";

/**
 * Los tipos que el motor no sabe ejecutar, con el motivo en el idioma de quien
 * arma el flujo. Se muestra tal cual en la paleta y en el error de publicar.
 *
 * Quien escribe el handler de uno lo saca de acá: el test de disponibilidad
 * falla si queda marcado con handler.
 */
export const NO_DISPONIBLES: Readonly<Partial<Record<NodoTipo, string>>> = {
  // ── Disparadores sin emisor ─────────────────────────────────────────────
  trigger_webhook: "Todavía no hay una dirección que reciba webhooks para arrancar un flujo.",
  trigger_formulario: "No hay formularios web conectados: nada puede arrancar este flujo.",

  // ── Mensajería que el envío a Meta no sabe mandar ─────────────────────
  msg_documento:
    "El envío a Meta no sabe mandar documentos todavía: sólo texto, plantillas, botones, listas, imágenes y ubicaciones.",
  msg_reaccion:
    "El envío a Meta no sabe mandar reacciones todavía: sólo texto, plantillas, botones, listas, imágenes y ubicaciones.",

  // ── CRM ───────────────────────────────────────────────────────────────
  crm_etiqueta_remove:
    "Sacar una etiqueta hoy queda registrado como decisión de una persona, y ninguna regla la vuelve a poner: un flujo que la saca la bloquearía para siempre.",
  crm_tarea: "El CRM no tiene tareas: no hay dónde crearla.",
  crm_nota: "El CRM no tiene notas internas: no hay dónde guardarla.",
  crm_spam: "El lead no tiene marca de spam: no hay dónde registrarla.",
  crm_archivar: "Los leads no se archivan en este CRM: no hay dónde registrarlo.",

  // ── Lógica ────────────────────────────────────────────────────────────
  // El diseño del editor no dibuja ninguno de estos cuatro, y darles semántica
  // de motor sería inventarla: quedan a la vista, atenuados, con el motivo.
  logica_validacion:
    "El motor no tiene un paso de validación: usá una condición para bifurcar según el dato.",
  logica_loop: "El motor no recorre listas: no sabe repetir un tramo por cada elemento.",
  logica_grupo: "Agrupar es sólo visual y el motor no reconoce el bloque.",
  logica_error:
    "El motor no tiene manejo de errores por bloque: un paso que falla termina la corrida.",

  // ── Integraciones ─────────────────────────────────────────────────────
  int_http: "Las llamadas HTTP a sistemas externos no están implementadas.",
  int_webhook_out: "Los webhooks salientes no están implementados.",
  int_codigo:
    "Correr código escrito en el flujo no está soportado: sería ejecutar código arbitrario en el servidor.",
  int_email: "El proyecto no tiene un proveedor de email conectado.",
  int_sheets: "No hay integración con Google Sheets.",
  int_db: "Las consultas SQL libres desde un flujo no están soportadas.",

  // ── IA ────────────────────────────────────────────────────────────────
  ia_clasificar: TODAVIA_SIN_IA,
  ia_responder: TODAVIA_SIN_IA,
  ia_extraer: TODAVIA_SIN_IA,
  ia_sentimiento: TODAVIA_SIN_IA,
  ia_resumir: TODAVIA_SIN_IA,
  ia_traducir: TODAVIA_SIN_IA,
  ia_spam: TODAVIA_SIN_IA,
  // ── Internos ──────────────────────────────────────────────────────────
  int_notif_grupo: "No hay canales de grupo conectados.",
  int_comentario: "El CRM no tiene comentarios internos: no hay dónde guardarlo.",
  int_debug:
    "El motor no tiene un paso de log: lo que hace cada paso ya queda en el historial de la corrida.",

  // ── Difusión (PRD §4.6) ───────────────────────────────────────────────
  // Los cinco operan sobre un GRUPO (armarlo, recortarlo, mandarle, partirlo,
  // esperar a que conteste), y el motor corre cada flujo para UN lead: una
  // corrida por lead, con su sesión. Sin un flujo que corra sobre una
  // audiencia no hay a quién aplicárselos. Las difusiones se arman y se mandan
  // desde la pantalla Difusión, que ya tiene audiencia, pre-vuelo y motor de
  // envío; lo que sí corre en un flujo es el disparador "Difusión respondida".
  dif_audiencia: DIFUSION_ES_DE_GRUPO,
  dif_enviar: DIFUSION_ES_DE_GRUPO,
  dif_excluir: DIFUSION_ES_DE_GRUPO,
  dif_esperar_respuesta:
    "Depende de «Enviar difusión» en el mismo flujo, que no corre: un flujo no puede saber a qué difusión esperar. Para reaccionar a una respuesta, usá el disparador «Difusión respondida».",
  dif_dividir: DIFUSION_ES_DE_GRUPO,
};

/** Por qué vía se ejecuta un tipo. `sin_clasificar` es un bug: lo caza el test. */
export type ClaseDeTipo = "motor" | "disparador" | "accion" | "no_disponible" | "sin_clasificar";

export function clasificarTipo(tipo: NodoTipo): ClaseDeTipo {
  if (esTrigger(tipo)) {
    // El legacy `disparador` declara su evento en la config; esa config la
    // revisa `config-nodos.ts` contra `DISPARADORES`, que son todos con emisor.
    if (tipo === "disparador" || Object.hasOwn(DISPARADOR_DE_TIPO, tipo)) return "disparador";
    return Object.hasOwn(NO_DISPONIBLES, tipo) ? "no_disponible" : "sin_clasificar";
  }
  if (esFinal(tipo) || esCondicion(tipo) || esEspera(tipo) || esSwitch(tipo) || esSalto(tipo)) {
    return "motor";
  }
  // El legacy `accion` declara su acción en la config: si no es una del
  // catálogo, lo rechaza la revisión de config, no esta.
  if (tipo === "accion" || Object.hasOwn(ACCION_DE_TIPO, tipo)) return "accion";
  return Object.hasOwn(NO_DISPONIBLES, tipo) ? "no_disponible" : "sin_clasificar";
}

export type Disponibilidad = { disponible: true } | { disponible: false; motivo: string };

/**
 * Si un bloque se puede ejecutar y, si no, por qué. Un tipo sin clasificar
 * cuenta como no disponible: falla cerrado, y el test de disponibilidad lo
 * marca como el bug que es.
 */
export function disponibilidadDeTipo(tipo: NodoTipo): Disponibilidad {
  const clase = clasificarTipo(tipo);
  if (clase === "motor" || clase === "disparador" || clase === "accion") {
    return { disponible: true };
  }
  return {
    disponible: false,
    motivo: NO_DISPONIBLES[tipo] ?? "Nadie decidió todavía cómo se ejecuta este bloque.",
  };
}
