/**
 * Handlers de nodos de integración.
 *
 * HTTP requests, webhooks salientes, código custom, etc. Estos handlers
 * preparan los datos y devuelven la configuración para que el wiring
 * de Inngest ejecute la llamada real.
 *
 * Excepción: int_codigo ejecuta código en un sandbox controlado.
 */

import type { ContextoEjecucion } from "../contexto-ejecucion";
import { registrarHandler, type ResultadoHandler } from "./registro";

/**
 * HTTP Request.
 * Llama a una API externa.
 */
async function intHttp(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const metodo = ((config.metodo as string) ?? "GET").toUpperCase();
  const url = config.url as string | undefined;
  const headers = config.headers as Record<string, string> | undefined;
  const body = config.body;
  const variableRespuesta = config.variable_respuesta as string | undefined;

  if (!url) {
    throw new Error("El nodo int_http requiere una URL");
  }

  // Validar URL
  try {
    new URL(url);
  } catch {
    throw new Error(`URL inválida: ${url}`);
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_http",
      metodo,
      url,
      headers,
      body,
      variable_respuesta: variableRespuesta ?? "http_response",
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Webhook saliente.
 * Notifica a un endpoint externo.
 */
async function intWebhookOut(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const url = config.url as string | undefined;
  const incluirLead = (config.incluir_lead as boolean) ?? true;
  const incluirSesion = (config.incluir_sesion as boolean) ?? false;
  const datosExtra = config.datos_extra as Record<string, unknown> | undefined;

  if (!url) {
    throw new Error("El nodo int_webhook_out requiere una URL");
  }

  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    workflow_id: ctx.workflowId,
    run_id: ctx.runId,
    ...datosExtra,
  };

  if (incluirLead && ctx.lead) {
    payload.lead = {
      id: ctx.lead.id,
      nombre: ctx.lead.nombre,
      telefono: ctx.lead.telefono,
      canal: ctx.lead.canal_origen,
    };
  }

  if (incluirSesion && ctx.sesion) {
    payload.sesion = {
      id: ctx.sesion.id,
      etapa: ctx.sesion.current_stage,
      consulta: ctx.sesion.consulta,
    };
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_webhook_out",
      url,
      payload,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Código JavaScript custom.
 *
 * En producción esto ejecutaría en un sandbox (vm2, isolated-vm, o similar).
 * Por ahora solo preparamos los datos y marcamos como pendiente.
 */
async function intCodigo(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const codigo = config.codigo as string | undefined;
  const variableSalida = config.variable_salida as string | undefined;

  if (!codigo) {
    throw new Error("El nodo int_codigo requiere código");
  }

  // En un entorno real, validaríamos el código antes de ejecutar
  // y lo ejecutaríamos en un sandbox con timeout

  return {
    puerto: "salida",
    salida: {
      tipo: "int_codigo",
      codigo_hash: codigo.length.toString(), // No loguear el código completo
      variable_salida: variableSalida,
      contexto_disponible: {
        lead: !!ctx.lead,
        sesion: !!ctx.sesion,
        variables: ctx.variables.size,
      },
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Enviar email.
 */
async function intEmail(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const destinatario = config.destinatario as string | undefined;
  const asunto = config.asunto as string | undefined;
  const cuerpo = config.cuerpo as string | undefined;
  const html = (config.html as boolean) ?? false;

  if (!destinatario || !asunto || !cuerpo) {
    throw new Error("El nodo int_email requiere destinatario, asunto y cuerpo");
  }

  // Validar email básico
  if (!destinatario.includes("@")) {
    throw new Error(`Email inválido: ${destinatario}`);
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_email",
      destinatario,
      asunto,
      html,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Google Sheets (leer/escribir).
 */
async function intSheets(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const operacion = config.operacion as "leer" | "escribir" | undefined;
  const spreadsheetId = config.spreadsheet_id as string | undefined;
  const rango = config.rango as string | undefined;
  const datos = config.datos as unknown[][] | undefined;

  if (!spreadsheetId || !rango) {
    throw new Error("El nodo int_sheets requiere spreadsheet_id y rango");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_sheets",
      operacion: operacion ?? "leer",
      spreadsheet_id: spreadsheetId,
      rango,
      filas: datos?.length ?? 0,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Query a base de datos externa.
 */
async function intDb(
  config: Record<string, unknown>,
  _ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const conexion = config.conexion as string | undefined;
  const query = config.query as string | undefined;
  const parametros = config.parametros as unknown[] | undefined;
  const variableResultado = config.variable_resultado as string | undefined;

  if (!conexion || !query) {
    throw new Error("El nodo int_db requiere conexion y query");
  }

  // Validación básica de seguridad: no permitir DROP, DELETE sin WHERE, etc.
  const queryUpper = query.toUpperCase();
  const peligroso = ["DROP ", "TRUNCATE ", "ALTER ", "CREATE "].some((cmd) =>
    queryUpper.includes(cmd),
  );

  if (peligroso) {
    throw new Error("Query contiene comandos no permitidos");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "int_db",
      conexion,
      query_tipo: queryUpper.startsWith("SELECT") ? "select" : "other",
      parametros_count: parametros?.length ?? 0,
      variable_resultado: variableResultado ?? "db_result",
      pendiente_ejecucion: true,
    },
  };
}

// Registrar todos los handlers de integración
export function registrarHandlersIntegracion(): void {
  registrarHandler("int_http", intHttp);
  registrarHandler("int_webhook_out", intWebhookOut);
  registrarHandler("int_codigo", intCodigo);
  registrarHandler("int_email", intEmail);
  registrarHandler("int_sheets", intSheets);
  registrarHandler("int_db", intDb);
}
