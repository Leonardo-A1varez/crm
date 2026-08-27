/**
 * Handlers de nodos CRM.
 *
 * Operaciones sobre leads, etiquetas, etapas y asignaciones. Como los de
 * mensajería, estos handlers preparan la operación pero NO la ejecutan
 * directamente contra la base — el wiring con los repos reales lo hace
 * el bootstrap de Inngest.
 */

import type { ContextoEjecucion } from "../contexto-ejecucion";
import { registrarHandler, type ResultadoHandler } from "./registro";

/**
 * Asignar etiqueta a un lead.
 */
async function crmEtiquetaAdd(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const etiquetas = config.etiquetas as string[] | undefined;
  const etiquetaId = config.etiqueta_id as string | undefined;

  // Soportar tanto array de etiquetas como una sola
  const etiquetasAAgregar = etiquetas ?? (etiquetaId ? [etiquetaId] : []);

  if (etiquetasAAgregar.length === 0) {
    throw new Error("El nodo crm_etiqueta_add requiere al menos una etiqueta");
  }

  return {
    puerto: "salida",
    contexto: {
      etiquetas_agregadas: etiquetasAAgregar,
    },
    salida: {
      tipo: "crm_etiqueta_add",
      etiquetas: etiquetasAAgregar,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Remover etiqueta de un lead.
 */
async function crmEtiquetaRemove(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const etiquetas = config.etiquetas as string[] | undefined;
  const etiquetaId = config.etiqueta_id as string | undefined;

  const etiquetasARemover = etiquetas ?? (etiquetaId ? [etiquetaId] : []);

  if (etiquetasARemover.length === 0) {
    throw new Error("El nodo crm_etiqueta_remove requiere al menos una etiqueta");
  }

  return {
    puerto: "salida",
    contexto: {
      etiquetas_removidas: etiquetasARemover,
    },
    salida: {
      tipo: "crm_etiqueta_remove",
      etiquetas: etiquetasARemover,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Cambiar etapa del lead.
 */
async function crmEtapa(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const etapa = config.etapa as string | undefined;

  if (!etapa) {
    throw new Error("El nodo crm_etapa requiere una etapa destino");
  }

  const etapaAnterior = ctx.sesion?.current_stage;

  return {
    puerto: "salida",
    contexto: {
      etapa_anterior: etapaAnterior,
      etapa_nueva: etapa,
    },
    salida: {
      tipo: "crm_etapa",
      etapa,
      etapa_anterior: etapaAnterior,
      session_id: ctx.sesion?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Asignar vendedor específico.
 */
async function crmVendedor(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const vendedorId = config.vendedor_id as string | undefined;

  if (!vendedorId) {
    throw new Error("El nodo crm_vendedor requiere vendedor_id");
  }

  return {
    puerto: "salida",
    contexto: {
      vendedor_asignado: vendedorId,
    },
    salida: {
      tipo: "crm_vendedor",
      vendedor_id: vendedorId,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Asignar vendedor por round robin.
 */
async function crmRoundRobin(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const vendedores = config.vendedores as string[] | undefined;
  const modo = (config.modo as string) ?? "equitativo";

  if (!vendedores || vendedores.length === 0) {
    throw new Error("El nodo crm_round_robin requiere una lista de vendedores");
  }

  // El selector real lo hace el wiring de Inngest
  return {
    puerto: "salida",
    salida: {
      tipo: "crm_round_robin",
      vendedores,
      modo,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Actualizar un campo del lead o sesión.
 */
async function crmCampo(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const campo = config.campo as string | undefined;
  const valor = config.valor;

  if (!campo) {
    throw new Error("El nodo crm_campo requiere el nombre del campo");
  }

  return {
    puerto: "salida",
    contexto: {
      [`campo_actualizado_${campo}`]: valor,
    },
    salida: {
      tipo: "crm_campo",
      campo,
      valor,
      lead_id: ctx.lead?.id,
      session_id: ctx.sesion?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Crear tarea de seguimiento.
 */
async function crmTarea(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const titulo = config.titulo as string | undefined;
  const descripcion = config.descripcion as string | undefined;
  const vencimiento = config.vencimiento as string | undefined;
  const asignado = config.asignado_a as string | undefined;

  if (!titulo) {
    throw new Error("El nodo crm_tarea requiere un título");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "crm_tarea",
      titulo,
      descripcion,
      vencimiento,
      asignado_a: asignado ?? ctx.vendedor?.id,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Agregar nota interna a la conversación.
 */
async function crmNota(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const contenido = config.contenido as string | undefined;

  if (!contenido) {
    throw new Error("El nodo crm_nota requiere contenido");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "crm_nota",
      contenido,
      lead_id: ctx.lead?.id,
      session_id: ctx.sesion?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Marcar lead como spam.
 */
async function crmSpam(
  _config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  return {
    puerto: "salida",
    contexto: {
      marcado_spam: true,
    },
    salida: {
      tipo: "crm_spam",
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Archivar lead.
 */
async function crmArchivar(
  _config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  return {
    puerto: "salida",
    contexto: {
      archivado: true,
    },
    salida: {
      tipo: "crm_archivar",
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

// Registrar todos los handlers de CRM
export function registrarHandlersCrm(): void {
  registrarHandler("crm_etiqueta_add", crmEtiquetaAdd);
  registrarHandler("crm_etiqueta_remove", crmEtiquetaRemove);
  registrarHandler("crm_etapa", crmEtapa);
  registrarHandler("crm_vendedor", crmVendedor);
  registrarHandler("crm_round_robin", crmRoundRobin);
  registrarHandler("crm_campo", crmCampo);
  registrarHandler("crm_tarea", crmTarea);
  registrarHandler("crm_nota", crmNota);
  registrarHandler("crm_spam", crmSpam);
  registrarHandler("crm_archivar", crmArchivar);
}
