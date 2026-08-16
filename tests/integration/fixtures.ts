import type { TestClient } from "./setup";
import type { UUID } from "@/types/entities";

/**
 * Siembra compartida para los harnesses de integración.
 *
 * Casi todas las tablas del proyecto cuelgan de la misma cadena —lead → sesión
 * → conversación → mensaje— y antes cada harness la repetía entera. Con nueve
 * harnesses nuevos eso son nueve copias de las mismas columnas obligatorias, y
 * la primera migración que agregue una `NOT NULL` las rompe todas a la vez.
 *
 * Cada helper devuelve solo el id: es lo único que los contracts necesitan.
 */

/** Un lead nuevo. `telefono` sale del id para no chocar contra su UNIQUE. */
export async function sembrarLead(c: TestClient, etiqueta: string): Promise<UUID> {
  const id = crypto.randomUUID();
  const { error } = await c.from("leads").insert({
    id,
    nombre: `Fixture ${etiqueta}`,
    telefono: `+5${id.replace(/-/g, "").slice(0, 12)}`,
    canal_origen: "wa",
    meta_user_ids: {},
  });
  if (error) throw new Error(`seed leads: ${error.message}`);
  return id;
}

/**
 * Una sesión activa del lead.
 *
 * `lead_session_unique_activa_idx` admite una sola sesión activa por lead, así
 * que cada llamada quiere su propio lead salvo que se cierre la anterior.
 */
export async function sembrarSesion(c: TestClient, leadId: UUID, etiqueta: string): Promise<UUID> {
  const id = crypto.randomUUID();
  const { error } = await c
    .from("lead_session")
    .insert({ id, lead_id: leadId, consulta: `fixture ${etiqueta}` });
  if (error) throw new Error(`seed lead_session: ${error.message}`);
  return id;
}

/** Una conversación. `canal_thread_id` sale del id por el UNIQUE (canal, thread). */
export async function sembrarConversacion(c: TestClient, leadId: UUID): Promise<UUID> {
  const id = crypto.randomUUID();
  const { error } = await c
    .from("conversaciones")
    .insert({ id, lead_id: leadId, canal: "wa", canal_thread_id: `fix-${id.slice(0, 18)}` });
  if (error) throw new Error(`seed conversaciones: ${error.message}`);
  return id;
}

/** Un mensaje entrante del cliente, que es del que cuelgan las auditorías. */
export async function sembrarMensaje(
  c: TestClient,
  conversacionId: UUID,
  leadSessionId: UUID,
  contenido = "hola",
): Promise<UUID> {
  const id = crypto.randomUUID();
  const { error } = await c.from("mensajes").insert({
    id,
    conversacion_id: conversacionId,
    lead_session_id: leadSessionId,
    direction: "in",
    sender: "lead",
    tipo: "text",
    contenido,
  });
  if (error) throw new Error(`seed mensajes: ${error.message}`);
  return id;
}

/** La cadena entera de una vez, que es lo que necesita casi todo harness. */
export async function sembrarCadena(
  c: TestClient,
  etiqueta: string,
): Promise<{ leadId: UUID; sesionId: UUID; conversacionId: UUID; mensajeId: UUID }> {
  const leadId = await sembrarLead(c, etiqueta);
  const sesionId = await sembrarSesion(c, leadId, etiqueta);
  const conversacionId = await sembrarConversacion(c, leadId);
  const mensajeId = await sembrarMensaje(c, conversacionId, sesionId);
  return { leadId, sesionId, conversacionId, mensajeId };
}

export async function sembrarIntent(c: TestClient, nombre: string): Promise<UUID> {
  const id = crypto.randomUUID();
  const { error } = await c.from("intents").insert({
    id,
    nombre,
    descripcion: "fixture",
    ejemplos: [],
    auto_detectado: false,
    activo: true,
  });
  if (error) throw new Error(`seed intents: ${error.message}`);
  return id;
}

export async function sembrarRegla(c: TestClient, intentId: UUID): Promise<UUID> {
  const id = crypto.randomUUID();
  const { error } = await c.from("reglas").insert({
    id,
    intent_id: intentId,
    respuesta_tipo: "text",
    respuesta_contenido: "respuesta fixture",
    prioridad: 0,
    activa: true,
  });
  if (error) throw new Error(`seed reglas: ${error.message}`);
  return id;
}

export async function sembrarTag(c: TestClient, nombre: string): Promise<UUID> {
  const id = crypto.randomUUID();
  const { error } = await c.from("tags").insert({ id, nombre, color: "#3b82f6" });
  if (error) throw new Error(`seed tags: ${error.message}`);
  return id;
}
