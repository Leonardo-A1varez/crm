/**
 * Handlers de nodos de mensajería.
 *
 * Estos handlers preparan el envío de mensajes. La ejecución real del envío
 * la hace un servicio inyectado — estos handlers NO llaman a Meta directamente.
 * Razón: el motor es puro y testeable; el wiring con servicios reales
 * (MetaApiService, etc.) lo hace el bootstrap de Inngest.
 */

import type { ContextoEjecucion } from "../contexto-ejecucion";
import { registrarHandler, type ResultadoHandler } from "./registro";

/**
 * Enviar mensaje de texto.
 */
async function msgTexto(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const mensaje = config.mensaje as string | undefined;
  const canal = (config.canal as string) ?? ctx.lead?.canal_origen ?? "wa";

  if (!mensaje) {
    throw new Error("El nodo msg_texto requiere un mensaje");
  }

  return {
    puerto: "salida",
    contexto: {
      ultimo_mensaje_enviado: mensaje,
      ultimo_mensaje_canal: canal,
    },
    salida: {
      tipo: "msg_texto",
      mensaje,
      canal,
      lead_id: ctx.lead?.id,
      // El mensaje real se envía en el wiring de Inngest, no aquí
      pendiente_envio: true,
    },
  };
}

/**
 * Enviar mensaje con botones interactivos.
 */
async function msgBotones(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const mensaje = config.mensaje as string | undefined;
  const botones = config.botones as Array<{ id: string; texto: string }> | undefined;

  if (!mensaje || !botones || botones.length === 0) {
    throw new Error("El nodo msg_botones requiere mensaje y al menos un botón");
  }

  if (botones.length > 3) {
    throw new Error("WhatsApp permite máximo 3 botones");
  }

  return {
    puerto: "salida",
    contexto: {
      ultimo_mensaje_enviado: mensaje,
      botones_ofrecidos: botones.map((b) => b.texto),
    },
    salida: {
      tipo: "msg_botones",
      mensaje,
      botones,
      lead_id: ctx.lead?.id,
      pendiente_envio: true,
    },
  };
}

/**
 * Enviar mensaje de lista (WhatsApp).
 */
async function msgLista(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const mensaje = config.mensaje as string | undefined;
  const botonTexto = config.boton_texto as string | undefined;
  const secciones = config.secciones as
    | Array<{
        titulo: string;
        items: Array<{ id: string; titulo: string; descripcion?: string }>;
      }>
    | undefined;

  if (!mensaje || !secciones || secciones.length === 0) {
    throw new Error("El nodo msg_lista requiere mensaje y al menos una sección");
  }

  return {
    puerto: "salida",
    contexto: {
      ultimo_mensaje_enviado: mensaje,
      lista_secciones: secciones.length,
    },
    salida: {
      tipo: "msg_lista",
      mensaje,
      boton_texto: botonTexto ?? "Ver opciones",
      secciones,
      lead_id: ctx.lead?.id,
      pendiente_envio: true,
    },
  };
}

/**
 * Enviar imagen con caption opcional.
 */
async function msgImagen(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const url = config.url as string | undefined;
  const caption = config.caption as string | undefined;

  if (!url) {
    throw new Error("El nodo msg_imagen requiere una URL de imagen");
  }

  return {
    puerto: "salida",
    contexto: {
      ultimo_media_enviado: url,
      ultimo_media_tipo: "imagen",
    },
    salida: {
      tipo: "msg_imagen",
      url,
      caption,
      lead_id: ctx.lead?.id,
      pendiente_envio: true,
    },
  };
}

/**
 * Enviar documento (PDF, Excel, etc.).
 */
async function msgDocumento(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const url = config.url as string | undefined;
  const nombre = config.nombre as string | undefined;
  const caption = config.caption as string | undefined;

  if (!url) {
    throw new Error("El nodo msg_documento requiere una URL de documento");
  }

  return {
    puerto: "salida",
    contexto: {
      ultimo_media_enviado: url,
      ultimo_media_tipo: "documento",
    },
    salida: {
      tipo: "msg_documento",
      url,
      nombre: nombre ?? "documento",
      caption,
      lead_id: ctx.lead?.id,
      pendiente_envio: true,
    },
  };
}

/**
 * Enviar ubicación.
 */
async function msgUbicacion(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const latitud = config.latitud as number | undefined;
  const longitud = config.longitud as number | undefined;
  const nombre = config.nombre as string | undefined;
  const direccion = config.direccion as string | undefined;

  if (latitud === undefined || longitud === undefined) {
    throw new Error("El nodo msg_ubicacion requiere latitud y longitud");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "msg_ubicacion",
      latitud,
      longitud,
      nombre,
      direccion,
      lead_id: ctx.lead?.id,
      pendiente_envio: true,
    },
  };
}

/**
 * Enviar plantilla HSM aprobada.
 */
async function msgPlantilla(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const templateName = config.template_name as string | undefined;
  const language = (config.language as string) ?? "es";
  const componentes = config.componentes as Record<string, unknown>[] | undefined;

  if (!templateName) {
    throw new Error("El nodo msg_plantilla requiere template_name");
  }

  return {
    puerto: "salida",
    contexto: {
      plantilla_enviada: templateName,
    },
    salida: {
      tipo: "msg_plantilla",
      template_name: templateName,
      language,
      componentes,
      lead_id: ctx.lead?.id,
      pendiente_envio: true,
    },
  };
}

/**
 * Enviar reacción a un mensaje.
 */
async function msgReaccion(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const emoji = config.emoji as string | undefined;
  const mensajeId = (config.mensaje_id as string) ?? ctx.mensaje?.meta_message_id;

  if (!emoji) {
    throw new Error("El nodo msg_reaccion requiere un emoji");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "msg_reaccion",
      emoji,
      mensaje_id: mensajeId,
      lead_id: ctx.lead?.id,
      pendiente_envio: true,
    },
  };
}

// Registrar todos los handlers de mensajería
export function registrarHandlersMensajeria(): void {
  registrarHandler("msg_texto", msgTexto);
  registrarHandler("msg_botones", msgBotones);
  registrarHandler("msg_lista", msgLista);
  registrarHandler("msg_imagen", msgImagen);
  registrarHandler("msg_documento", msgDocumento);
  registrarHandler("msg_ubicacion", msgUbicacion);
  registrarHandler("msg_plantilla", msgPlantilla);
  registrarHandler("msg_reaccion", msgReaccion);
}
