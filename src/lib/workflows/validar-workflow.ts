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

import { esTrigger } from "@/types/workflows";
import type { Grafo, Nodo, ProblemaGrafo } from "@/types/workflows";
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
 * Cada tipo de nodo tiene campos requeridos en `config` para poder ejecutarse.
 * Esta función verifica que estén presentes y sean válidos.
 */
function validarConfigNodo(nodo: Nodo): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];
  const config = nodo.config;

  switch (nodo.tipo) {
    // --- Mensajería ---
    case "msg_texto": {
      const mensaje = config["mensaje"];
      if (!mensaje || (typeof mensaje === "string" && !mensaje.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "El mensaje no puede estar vacío",
        });
      }
      break;
    }

    case "msg_botones": {
      const mensaje = config["mensaje"];
      const botones = config["botones"] as unknown[] | undefined;
      if (!mensaje || (typeof mensaje === "string" && !mensaje.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "El mensaje con botones necesita un texto",
        });
      }
      if (!botones || !Array.isArray(botones) || botones.length === 0) {
        errores.push({
          tipo: "error",
          mensaje: "Debes agregar al menos un botón",
        });
      }
      if (Array.isArray(botones) && botones.length > 3) {
        errores.push({
          tipo: "warning",
          mensaje: "WhatsApp solo permite hasta 3 botones",
        });
      }
      break;
    }

    case "msg_lista": {
      const titulo = config["titulo"];
      const secciones = config["secciones"] as unknown[] | undefined;
      if (!titulo || (typeof titulo === "string" && !titulo.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "La lista necesita un título",
        });
      }
      if (!secciones || !Array.isArray(secciones) || secciones.length === 0) {
        errores.push({
          tipo: "error",
          mensaje: "Debes agregar al menos una sección a la lista",
        });
      }
      break;
    }

    case "msg_imagen":
    case "msg_documento": {
      const url = config["url"] ?? config["media_url"];
      if (!url || (typeof url === "string" && !url.trim())) {
        errores.push({
          tipo: "error",
          mensaje: `${nodo.tipo === "msg_imagen" ? "La imagen" : "El documento"} necesita una URL`,
        });
      }
      break;
    }

    case "msg_plantilla": {
      const templateName = config["template_name"] ?? config["nombre"];
      if (!templateName || (typeof templateName === "string" && !templateName.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona una plantilla HSM",
        });
      }
      break;
    }

    // --- Lógica ---
    case "logica_condicion":
    case "condicion": {
      const campo = config["campo"];
      const operador = config["operador"];
      if (!campo) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona un campo para la condición",
        });
      }
      if (!operador) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona un operador",
        });
      }
      break;
    }

    case "logica_switch": {
      const campo = config["campo"];
      const casos = config["casos"] as unknown[] | undefined;
      if (!campo) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona un campo para el switch",
        });
      }
      if (!casos || !Array.isArray(casos) || casos.length === 0) {
        errores.push({
          tipo: "warning",
          mensaje: "El switch no tiene casos definidos",
        });
      }
      break;
    }

    case "logica_esperar":
    case "espera": {
      const duracion = config["duracion"] ?? config["tiempo"];
      if (!duracion) {
        errores.push({
          tipo: "error",
          mensaje: "Define cuánto tiempo esperar",
        });
      }
      break;
    }

    case "logica_esperar_respuesta": {
      const timeout = config["timeout"];
      if (!timeout) {
        errores.push({
          tipo: "warning",
          mensaje: "No hay timeout definido, la espera podría ser indefinida",
          sugerencia: "Configura un tiempo máximo de espera",
        });
      }
      break;
    }

    // --- CRM ---
    case "crm_etiqueta_add":
    case "crm_etiqueta_remove": {
      const tagId = config["tag_id"] ?? config["etiqueta_id"];
      if (!tagId) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona una etiqueta",
        });
      }
      break;
    }

    case "crm_etapa": {
      const etapa = config["etapa"];
      if (!etapa) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona a qué etapa mover",
        });
      }
      break;
    }

    case "crm_vendedor": {
      const vendedorId = config["vendedor_id"] ?? config["user_id"];
      if (!vendedorId) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona un vendedor para asignar",
        });
      }
      break;
    }

    case "crm_campo": {
      const campo = config["campo"];
      const valor = config["valor"];
      if (!campo) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona qué campo actualizar",
        });
      }
      if (valor === undefined || valor === null || valor === "") {
        errores.push({
          tipo: "warning",
          mensaje: "El valor del campo está vacío",
        });
      }
      break;
    }

    // --- Integraciones ---
    case "int_http": {
      const url = config["url"];
      const metodo = config["metodo"] ?? config["method"];
      if (!url || (typeof url === "string" && !url.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "La petición HTTP necesita una URL",
        });
      }
      if (!metodo) {
        errores.push({
          tipo: "warning",
          mensaje: "No hay método HTTP definido, se usará GET",
        });
      }
      break;
    }

    case "int_webhook_out": {
      const url = config["url"];
      if (!url || (typeof url === "string" && !url.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "El webhook necesita una URL de destino",
        });
      }
      break;
    }

    case "int_email": {
      const to = config["to"] ?? config["destinatario"];
      const subject = config["subject"] ?? config["asunto"];
      const body = config["body"] ?? config["cuerpo"];
      if (!to) {
        errores.push({
          tipo: "error",
          mensaje: "El email necesita un destinatario",
        });
      }
      if (!subject) {
        errores.push({
          tipo: "warning",
          mensaje: "El email no tiene asunto",
        });
      }
      if (!body) {
        errores.push({
          tipo: "warning",
          mensaje: "El email no tiene contenido",
        });
      }
      break;
    }

    case "int_codigo": {
      const codigo = config["codigo"] ?? config["code"];
      if (!codigo || (typeof codigo === "string" && !codigo.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "El bloque de código está vacío",
        });
      }
      break;
    }

    // --- IA ---
    case "ia_responder": {
      const prompt = config["prompt"] ?? config["instrucciones"];
      if (!prompt || (typeof prompt === "string" && !prompt.trim())) {
        errores.push({
          tipo: "warning",
          mensaje: "No hay instrucciones para la IA",
          sugerencia: "Agrega un prompt para guiar la respuesta",
        });
      }
      break;
    }

    // --- Triggers ---
    case "trigger_webhook": {
      // El webhook se auto-genera, pero podría necesitar validación de permisos
      break;
    }

    case "trigger_cron": {
      const expresion = config["cron"] ?? config["expresion"];
      if (!expresion || (typeof expresion === "string" && !expresion.trim())) {
        errores.push({
          tipo: "error",
          mensaje: "Define la frecuencia de ejecución (expresión cron)",
        });
      }
      break;
    }

    case "trigger_etiqueta":
    case "trigger_etiqueta_removida": {
      const tagId = config["tag_id"] ?? config["etiqueta_id"];
      if (!tagId) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona qué etiqueta dispara el workflow",
        });
      }
      break;
    }

    case "trigger_etapa": {
      const etapa = config["etapa"];
      if (!etapa) {
        errores.push({
          tipo: "error",
          mensaje: "Selecciona qué etapa dispara el workflow",
        });
      }
      break;
    }

    case "trigger_inactividad": {
      const tiempo = config["tiempo"] ?? config["duracion"];
      if (!tiempo) {
        errores.push({
          tipo: "error",
          mensaje: "Define el tiempo de inactividad que dispara el workflow",
        });
      }
      break;
    }

    // Tipos que no requieren configuración adicional
    case "trigger_mensaje":
    case "trigger_manual":
    case "trigger_lead_creado":
    case "trigger_vendedor_asignado":
    case "trigger_formulario":
    case "disparador":
    case "accion":
    case "fin":
    case "logica_detener":
    case "logica_goto":
    case "logica_grupo":
    case "logica_validacion":
    case "logica_loop":
    case "logica_error":
    case "logica_esperar_evento":
    case "msg_ubicacion":
    case "msg_reaccion":
    case "crm_round_robin":
    case "crm_tarea":
    case "crm_nota":
    case "crm_spam":
    case "crm_archivar":
    case "int_sheets":
    case "int_db":
    case "ia_clasificar":
    case "ia_extraer":
    case "ia_sentimiento":
    case "ia_resumir":
    case "ia_traducir":
    case "ia_spam":
    case "int_notif_vendedor":
    case "int_notif_grupo":
    case "int_comentario":
    case "int_debug":
      // Sin validación específica adicional
      break;

    default: {
      // Tipo desconocido — no es un error, puede ser un tipo nuevo
      // que este validador no conoce todavía
      break;
    }
  }

  return errores;
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

/**
 * Verifica si un workflow puede publicarse (sin errores críticos).
 */
export function puedePublicar(errores: ErrorValidacion[]): boolean {
  return errores.every((e) => e.tipo !== "error");
}
