import { ConflictError, IllegalStateError, InfraError, RateLimitError } from "@/lib/errors";
import { CLAVE_SESION_IMPORTADA, esSesionImportada } from "@/lib/coexistencia/sesion-importada";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type {
  ContactoCoexistencia,
  EcoCoexistencia,
  ErrorHistorial,
  LoteHistorial,
  MensajeCoexistencia,
} from "@/lib/meta/parse-coexistencia";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import {
  normalizarIdentificador,
  type LeadIdentificadoresRepository,
} from "@/server/repositories/lead-identificadores.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { WhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import type { ResolverCredencialesWhatsApp } from "@/server/services/meta/credenciales-whatsapp.service";
import type {
  GraphApiOnboarding,
  TipoSincronizacion,
} from "@/server/services/meta/graph-api-onboarding";
import type { Conversacion, Lead, MensajeMetadata } from "@/types/entities";
import type { Sincronizacion } from "@/types/whatsapp-numeros";

/**
 * Coexistencia: el número sigue en la app WhatsApp Business del teléfono y
 * además tiene Cloud API. Este servicio hace lo que pasa DESPUÉS de conectar
 * (docs/meta/conectar-whatsapp.md):
 *
 *   1. Verificar `is_on_biz_app` / `platform_type`.
 *   2. Pedir los contactos y después el historial (`smb_app_data`). Meta acepta
 *      cada uno UNA sola vez y dentro de las 24 h de la conexión: se reserva
 *      en la base antes de llamar, como los envíos (`MetaApiService.enviar`).
 *   3. Importar lo que llega por webhook: contactos → leads, historial y ecos →
 *      mensajes del hilo. Nada de esto pasa por el agente: no hay turno, no se
 *      clasifica, no se contesta.
 *
 * Nunca loguea teléfonos, nombres ni textos: sólo cantidades y estados.
 */

/** Ventana de Meta para pedir las sincronizaciones después de conectar. */
export const VENTANA_SINCRONIZACION_MS = 24 * 3600_000;

/** `history.errors[].code`: el negocio apagó compartir el historial en la app. */
export const CODIGO_HISTORIAL_RECHAZADO = 2593109;

export type ResultadoSincronizacion = "pedido" | "ya_pedido" | "vencido" | "error" | "omitido";

export interface ResumenSincronizacion {
  verificado: boolean;
  contactos: ResultadoSincronizacion;
  historial: ResultadoSincronizacion;
}

export interface CoexistenciaDeps {
  numeros: WhatsAppNumerosRepository;
  graph: Pick<GraphApiOnboarding, "leerNumero" | "pedirSincronizacion">;
  credenciales: ResolverCredencialesWhatsApp;
  leads: Pick<LeadsRepository, "findByTelefono" | "create" | "update">;
  identificadores: Pick<LeadIdentificadoresRepository, "create">;
  conversations: Pick<
    ConversationsRepository,
    "findByCanalThread" | "upsertByCanalThread" | "update" | "touch"
  >;
  sessions: Pick<LeadSessionRepository, "findActiveByLeadId" | "listByLeadId" | "create">;
  messages: Pick<MessagesRepository, "findByMetaMessageId" | "registrarSalienteYaEnviado">;
  ahora?: () => Date;
  logger?: Logger;
}

export interface CoexistenciaService {
  sincronizarAlConectar(phoneNumberId: string): Promise<ResumenSincronizacion>;
  importarContactos(contactos: readonly ContactoCoexistencia[]): Promise<{
    creados: number;
    nombrados: number;
    sinCambios: number;
    ignorados: number;
  }>;
  importarHistorial(lote: LoteHistorial): Promise<{ importados: number; repetidos: number }>;
  historialRechazado(error: ErrorHistorial): Promise<void>;
  registrarEco(eco: EcoCoexistencia): Promise<"registrado" | "repetido">;
}

const SYNC_DE: Record<Sincronizacion, TipoSincronizacion> = {
  contactos: "smb_app_state_sync",
  historial: "history",
};

export class DefaultCoexistenciaService implements CoexistenciaService {
  private readonly ahora: () => Date;
  private readonly logger: Logger;

  constructor(private readonly deps: CoexistenciaDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
    this.logger = deps.logger ?? new NoopLogger();
  }

  // ===========================================================================
  // Después de conectar
  // ===========================================================================

  async sincronizarAlConectar(phoneNumberId: string): Promise<ResumenSincronizacion> {
    const numero = await this.deps.numeros.buscar(phoneNumberId);
    if (!numero || numero.estado !== "conectado") {
      throw new IllegalStateError("el número no está conectado", "whatsapp_numero");
    }
    const credenciales = await this.deps.credenciales.para(phoneNumberId);
    if (!credenciales) {
      throw new IllegalStateError("el número conectado no tiene token", "whatsapp_numero");
    }
    const token = credenciales.accessToken;

    const leido = await this.deps.graph.leerNumero(phoneNumberId, token);
    await this.deps.numeros.registrarVerificacion(phoneNumberId, {
      is_on_biz_app: leido.is_on_biz_app,
      platform_type: leido.platform_type,
    });
    // La doc de Meta: coexistencia confirmada = `is_on_biz_app: true` y
    // `platform_type: CLOUD_API`.
    const verificado = leido.is_on_biz_app === true && leido.platform_type === "CLOUD_API";

    if (numero.modo !== "coexistencia" || !verificado) {
      if (numero.modo === "coexistencia") {
        await this.deps.numeros.registrarError(
          phoneNumberId,
          `Meta no confirma la coexistencia (is_on_biz_app=${String(leido.is_on_biz_app)}, platform_type=${leido.platform_type ?? "?"}). No se pidieron contactos ni historial.`,
        );
      }
      return { verificado, contactos: "omitido", historial: "omitido" };
    }

    const vence = numero.conectado_at.getTime() + VENTANA_SINCRONIZACION_MS;
    // En orden: la doc de Meta pide contactos (paso 1) y después historial (paso 2).
    const contactos = await this.pedir(phoneNumberId, token, "contactos", vence);
    const historial = await this.pedir(phoneNumberId, token, "historial", vence);
    this.logger.info("coexistencia.sincronizacion", { contactos, historial });
    return { verificado, contactos, historial };
  }

  private async pedir(
    phoneNumberId: string,
    token: string,
    tipo: Sincronizacion,
    vence: number,
  ): Promise<ResultadoSincronizacion> {
    if (this.ahora().getTime() > vence) {
      if (tipo === "historial") {
        await this.deps.numeros.actualizarHistorial(phoneNumberId, { estado: "vencido" });
      }
      await this.deps.numeros.registrarError(
        phoneNumberId,
        "Pasaron 24 h desde la conexión: Meta ya no acepta la sincronización. Hay que desconectar el número en la app y volver a conectarlo.",
      );
      return "vencido";
    }

    if (!(await this.deps.numeros.reservarSincronizacion(phoneNumberId, tipo))) {
      return "ya_pedido";
    }

    try {
      const requestId = await this.deps.graph.pedirSincronizacion(
        phoneNumberId,
        token,
        SYNC_DE[tipo],
      );
      await this.deps.numeros.confirmarSincronizacion(phoneNumberId, tipo, requestId);
      return "pedido";
    } catch (error) {
      // 429: Meta rechazó sin procesar. Se libera para que el reintento pida de verdad.
      if (error instanceof RateLimitError) {
        await this.deps.numeros.liberarSincronizacion(phoneNumberId, tipo);
        throw error;
      }
      // Lo demás queda a la vista y con la reserva tomada: Meta la acepta una
      // sola vez, y con un 5xx o sin respuesta no se sabe si la procesó.
      const desconocido = error instanceof InfraError;
      await this.deps.numeros.registrarError(
        phoneNumberId,
        `No se pudo pedir la sincronización de ${tipo}${desconocido ? " (sin respuesta clara de Meta)" : ""}: ${mensajeDe(error)}`,
      );
      if (tipo === "historial") {
        await this.deps.numeros.actualizarHistorial(phoneNumberId, { estado: "error" });
      }
      this.logger.warn("coexistencia.sincronizacion.fallo", {
        tipo,
        error_name: error instanceof Error ? error.name : "desconocido",
      });
      return "error";
    }
  }

  // ===========================================================================
  // Webhooks
  // ===========================================================================

  async importarContactos(contactos: readonly ContactoCoexistencia[]) {
    const r = { creados: 0, nombrados: 0, sinCambios: 0, ignorados: 0 };
    for (const c of contactos) {
      // Quitar un contacto de la agenda del teléfono no borra un lead: el CRM
      // tiene su historia y sus sesiones.
      if (c.accion === "remove") {
        r.ignorados += 1;
        continue;
      }
      const existente = await this.deps.leads.findByTelefono(c.telefono);
      if (!existente) {
        await this.crearLead(c.telefono, c.nombre ?? "");
        r.creados += 1;
        continue;
      }
      // El nombre que cargó el vendedor no se pisa nunca; sólo se llena el vacío.
      if (c.nombre && existente.nombre.trim() === "") {
        await this.deps.leads.update(existente.id, { nombre: c.nombre });
        r.nombrados += 1;
      } else {
        r.sinCambios += 1;
      }
    }
    this.logger.info("coexistencia.contactos", r);
    return r;
  }

  async importarHistorial(lote: LoteHistorial) {
    let importados = 0;
    let repetidos = 0;
    for (const hilo of lote.hilos) {
      const r = await this.registrarEnHilo(
        lote.phone_number_id,
        hilo.telefono_cliente,
        hilo.mensajes,
        "historial_app_business",
        "importada",
      );
      importados += r.importados;
      repetidos += r.repetidos;
    }
    if (lote.progreso !== null) {
      await this.deps.numeros.actualizarHistorial(lote.phone_number_id, {
        estado: lote.progreso >= 100 ? "completo" : "en_curso",
        progreso: Math.max(0, Math.min(100, lote.progreso)),
      });
    }
    this.logger.info("coexistencia.historial", {
      fase: lote.fase,
      chunk: lote.chunk,
      progreso: lote.progreso,
      importados,
      repetidos,
      omitidos: lote.omitidos,
    });
    return { importados, repetidos };
  }

  async historialRechazado(error: ErrorHistorial): Promise<void> {
    if (error.codigo === CODIGO_HISTORIAL_RECHAZADO) {
      await this.deps.numeros.actualizarHistorial(error.phone_number_id, { estado: "rechazado" });
      return;
    }
    await this.deps.numeros.actualizarHistorial(error.phone_number_id, { estado: "error" });
    await this.deps.numeros.registrarError(
      error.phone_number_id,
      `Meta informó un error en el historial (código ${error.codigo ?? "desconocido"}).`,
    );
  }

  async registrarEco(eco: EcoCoexistencia): Promise<"registrado" | "repetido"> {
    const r = await this.registrarEnHilo(
      eco.phone_number_id,
      eco.telefono_cliente,
      [eco.mensaje],
      "eco_app_business",
      "activa",
    );
    return r.importados === 1 ? "registrado" : "repetido";
  }

  // ===========================================================================
  // Internos
  // ===========================================================================

  private async registrarEnHilo(
    phoneNumberId: string,
    telefono: string,
    mensajes: readonly MensajeCoexistencia[],
    origen: NonNullable<MensajeMetadata["origen"]>,
    /**
     * `activa`: un eco es actividad de hoy y vive en la sesión abierta del lead.
     * `importada`: el historial es pasado; va a una sesión cerrada para que no
     * aparezca como conversación en el Inbox (ver `sesionImportada`).
     */
    destino: "activa" | "importada",
  ): Promise<{ importados: number; repetidos: number }> {
    const nuevos: MensajeCoexistencia[] = [];
    let repetidos = 0;
    for (const m of mensajes) {
      if (await this.deps.messages.findByMetaMessageId(m.meta_message_id)) repetidos += 1;
      else nuevos.push(m);
    }
    if (nuevos.length === 0) return { importados: 0, repetidos };

    const lead =
      (await this.deps.leads.findByTelefono(telefono)) ?? (await this.crearLead(telefono, ""));
    const previa = await this.deps.conversations.findByCanalThread("wa", telefono);
    let conv: Conversacion =
      previa ?? (await this.deps.conversations.upsertByCanalThread("wa", telefono, lead.id));
    if (!conv.whatsapp_phone_number_id) {
      conv = await this.deps.conversations.update(conv.id, {
        whatsapp_phone_number_id: phoneNumberId,
      });
    }
    const sesion =
      destino === "importada"
        ? await this.sesionImportada(
            lead,
            nuevos.map((m) => m.at ?? this.ahora()),
          )
        : await this.sesionActiva(lead);

    let importados = 0;
    let masReciente: Date | null = null;
    for (const m of nuevos) {
      const at = m.at ?? this.ahora();
      try {
        await this.deps.messages.registrarSalienteYaEnviado({
          conversacion_id: conv.id,
          lead_session_id: sesion,
          direction: m.direction,
          // Lo que salió desde la app lo mandó una persona del negocio; no se
          // sabe cuál, así que `sender_user_id` queda vacío.
          sender: m.direction === "in" ? "lead" : "humano",
          sender_user_id: null,
          tipo: m.tipo,
          contenido: m.contenido,
          media_url: null,
          meta_message_id: m.meta_message_id,
          idempotency_key: null,
          metadata: { origen },
          platform_created_at: at,
          created_at: at,
          estado_entrega: null,
          estado_entrega_at: null,
        });
        importados += 1;
        if (masReciente === null || at > masReciente) masReciente = at;
      } catch (error) {
        // Otro lote o una reentrega lo escribió entre la consulta y el insert.
        if (error instanceof ConflictError) repetidos += 1;
        else throw error;
      }
    }

    // La actividad del hilo es la del último mensaje real. Un hilo que nace del
    // historial no aparece arriba de la bandeja como si fuera de hoy, y uno que
    // ya existía no se atrasa por un mensaje viejo.
    if (masReciente && (previa === null || masReciente > conv.ultima_actividad_at)) {
      await this.deps.conversations.touch(conv.id, masReciente);
    }
    return { importados, repetidos };
  }

  private async sesionActiva(lead: Lead): Promise<string> {
    const activa = await this.deps.sessions.findActiveByLeadId(lead.id);
    if (activa) return activa.id;
    const nueva = await this.deps.sessions.create({
      lead_id: lead.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
      producto_cotizado_id: null,
      codigo_interno: null,
      precio_cotizado: null,
      cantidad: null,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: false,
    });
    return nueva.id;
  }

  /**
   * La sesión CERRADA donde cae el historial del lead: una por lead, que los
   * lotes siguientes (otras fases y chunks) reusan.
   *
   * Por qué cerrada: el Inbox lista las sesiones abiertas, y con 180 días de
   * chats cada contacto aparecería como una conversación en curso. Cerrada, el
   * historial se ve en la ficha del lead y, si el cliente vuelve a escribir, el
   * pipeline abre una sesión nueva como siempre.
   *
   * Nace cerrada en una sola escritura (con `resultado`): crearla abierta y
   * cerrarla después dejaría, si falla entre las dos, una sesión activa fantasma.
   * Se cierra como `perdido` sin motivo porque es lo único que el esquema
   * admite junto a `exito`; la marca en `extras` es lo que distingue estas
   * sesiones de una venta perdida de verdad (`esSesionImportada`). Las fechas son
   * las del primer y el último mensaje del primer lote, no las de la importación.
   */
  private async sesionImportada(lead: Lead, horas: readonly Date[]): Promise<string> {
    const existente = (await this.deps.sessions.listByLeadId(lead.id)).find(esSesionImportada);
    if (existente) return existente.id;
    const tiempos = horas.map((h) => h.getTime());
    const nueva = await this.deps.sessions.create({
      lead_id: lead.id,
      current_stage: "perdido",
      urgencia: "media",
      consulta: "",
      producto_cotizado_id: null,
      codigo_interno: null,
      precio_cotizado: null,
      cantidad: null,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: "perdido",
      motivo_perdida: null,
      ia_pausada: false,
      extras: { [CLAVE_SESION_IMPORTADA]: true },
      started_at: new Date(Math.min(...tiempos)),
      closed_at: new Date(Math.max(...tiempos)),
    });
    return nueva.id;
  }

  /**
   * Mismo lead que crea el pipeline de entrantes, sin emitir `lead/created`: un
   * contacto de la agenda o del historial no es un cliente que escribió hoy, y
   * ese evento dispara los flujos "Lead creado" (bienvenidas). El detector de
   * duplicados lo encuentra igual en su corrida global.
   */
  private async crearLead(telefono: string, nombre: string): Promise<Lead> {
    const lead = await this.deps.leads.create({
      nombre,
      telefono,
      email: null,
      direccion: null,
      vehiculo_marca: null,
      vehiculo_modelo: null,
      vehiculo_anio: null,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: telefono },
    });
    try {
      await this.deps.identificadores.create({
        lead_id: lead.id,
        tipo: "telefono",
        valor: normalizarIdentificador("telefono", telefono),
        valor_original: telefono,
        principal: true,
        origen: "meta",
      });
    } catch (e) {
      // Sin el valor: el `details` de un 23505 trae el teléfono.
      this.logger.warn("coexistencia.identificador_no_creado", {
        lead_id: lead.id,
        error_name: (e as Error).name,
      });
    }
    return lead;
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "error desconocido";
}
