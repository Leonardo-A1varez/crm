import { cotasActividad } from "@/lib/actividad";
import { NotFoundError } from "@/lib/errors";
import { calcularSinResponder } from "@/lib/sin-responder";
import { MOTIVO_PERDIDA } from "@/types/domain";
import type { CierreSesion, LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import type { LeadMergeRepository } from "@/server/repositories/lead-merge.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { MotivoPerdida } from "@/types/domain";
import type { Lead, LeadIdentificador, LeadSession, Mensaje, UUID } from "@/types/entities";
import type {
  DuplicadoPendiente,
  EtiquetaOpcion,
  LeadDetail,
  LeadListItem,
  LeadsPage,
  VehiculoOpcion,
} from "@/types/leads";
import type { LeadsListInput, LeadsService } from "./leads.service";
import type {
  AgregarIdentificadorInput,
  QuitarIdentificadorInput,
} from "@/lib/validation/leads.schema";
import { ADMIN_ACTIONS, type AdminAuditService } from "@/server/services/admin-audit.service";

// Cap defensivo (patrón fase 9): sin paginación v1, la búsqueda acota.
const LIST_LIMIT = 1000;
const Q_MAX = 100;

export interface DefaultLeadsServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  candidates: MergeCandidatesRepository;
  tags: TagsRepository;
  /** Solo para el filtro "sin responder": los hilos se leen agrupados. */
  messages: MessagesRepository;
  audit: AdminAuditService;
  identificadores: LeadIdentificadoresRepository;
  /**
   * Historial de fusiones. Opcional: los contratos in-memory no modelan
   * `admin_actions`, y sin él la ficha simplemente no muestra esa sección.
   */
  merge?: LeadMergeRepository;
}

/** "Toyota Corolla 2018". El año se omite cuando la fila no lo tiene. */
function textoVehiculo(marca: string | null, modelo: string | null, anio: number | null): string {
  return [marca ?? "", modelo ?? "", anio !== null && anio > 0 ? String(anio) : ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

function vehiculoDe(lead: Lead): string {
  return textoVehiculo(lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio);
}

/**
 * Los vehículos distintos de estas filas, en orden alfabético castellano.
 *
 * Una pasada sobre las filas que ya están en memoria, no una consulta por lead
 * ni un `distinct` aparte: agregar leads no agrega consultas.
 */
function vehiculosDe(leads: readonly Lead[]): VehiculoOpcion[] {
  const out = new Map<string, VehiculoOpcion>();
  for (const l of leads) {
    const marca = l.vehiculo_marca?.trim() ?? "";
    const modelo = l.vehiculo_modelo?.trim() ?? "";
    const anio = l.vehiculo_anio !== null && l.vehiculo_anio > 0 ? l.vehiculo_anio : 0;
    const texto = textoVehiculo(marca, modelo, anio);
    if (texto === "") continue;
    const clave = `${marca}|${modelo}|${anio}`;
    if (!out.has(clave)) out.set(clave, { clave, texto, marca, modelo, anio });
  }
  return Array.from(out.values()).sort((a, b) => a.texto.localeCompare(b.texto, "es"));
}

/**
 * Los motivos que aparecen en el último cierre de alguno de estos leads, en el
 * orden del enum.
 *
 * Sale del mismo `listCierres()` que ya alimenta la columna de resultado: la
 * lista de motivos ofrecidos es exactamente la que puede devolver filas.
 */
function motivosDe(
  leads: readonly Lead[],
  cierrePorLead: Map<UUID, CierreSesion>,
): MotivoPerdida[] {
  const vistos = new Set<MotivoPerdida>();
  for (const l of leads) {
    const motivo = cierrePorLead.get(l.id)?.motivo_perdida;
    if (motivo) vistos.add(motivo);
  }
  return MOTIVO_PERDIDA.filter((m) => vistos.has(m));
}

/**
 * Último cierre de cada lead. `listCierres` viene del más reciente al más
 * viejo, así que el primero que aparece por lead es el que vale.
 */
function ultimosCierres(cierres: readonly CierreSesion[]): Map<UUID, CierreSesion> {
  const out = new Map<UUID, CierreSesion>();
  for (const c of cierres) {
    if (!out.has(c.lead_id)) out.set(c.lead_id, c);
  }
  return out;
}

/** Ids de sesión con entrantes posteriores a nuestra última respuesta. */
function sesionesPendientes(mensajes: readonly Mensaje[]): Set<UUID> {
  const porSesion = new Map<UUID, Mensaje[]>();
  for (const m of mensajes) {
    if (m.lead_session_id === null) continue;
    const hilo = porSesion.get(m.lead_session_id);
    if (hilo) hilo.push(m);
    else porSesion.set(m.lead_session_id, [m]);
  }
  const out = new Set<UUID>();
  for (const [sessionId, hilo] of porSesion) {
    if (calcularSinResponder(hilo).sinResponder > 0) out.add(sessionId);
  }
  return out;
}

export class DefaultLeadsService implements LeadsService {
  constructor(private readonly deps: DefaultLeadsServiceDeps) {}

  async listLeads(input: LeadsListInput = {}): Promise<LeadsPage> {
    const q = input.q?.trim().slice(0, Q_MAX);

    // El código de producto cotizado vive en `lead_session`, no en `leads`. Se
    // resuelve a ids antes de la consulta de leads para que entre en el mismo
    // OR: la alternativa —buscar leads y después mirar sus sesiones— sería una
    // consulta por fila y además perdería los leads que solo matchean por ahí.
    const idsPorCodigo = q ? await this.deps.sessions.listLeadIdsByCodigo(q) : [];

    // Un solo fetch de candidates pending: alimenta pendingPairs Y el filtro
    // soloDuplicados (nunca dos llamadas). Un solo listActive(): el badge
    // sesionActiva se cruza en memoria, nunca N+1 findActiveByLeadId por lead.
    // Un solo listCierres(): 4 columnas de las sesiones cerradas alcanzan para
    // decir cómo terminó cada lead.
    const [rows, activas, pendientes, cierres, catalogoEtiquetas] = await Promise.all([
      this.deps.leads.list({
        q: q || undefined,
        idsExtra: idsPorCodigo,
        canal: input.canal,
        ...cotasActividad(input.actividad, input.ahora ?? new Date()),
        limit: LIST_LIMIT,
      }),
      this.deps.sessions.listActive(),
      this.deps.candidates.list({ status: "pending" }),
      this.deps.sessions.listCierres(),
      this.deps.tags.list(),
    ]);

    const sesionPorLead = new Map<UUID, LeadSession>(activas.map((s) => [s.lead_id, s]));
    const cierrePorLead = ultimosCierres(cierres);
    const involucrados = new Set(pendientes.flatMap((c) => [c.src_lead_id, c.dst_lead_id]));

    // Las dos listas de opciones salen de lo que hay ANTES de filtrar por
    // ellas: si salieran de después, elegir un vehículo dejaría la
    // mini-pantalla con ese solo y no habría forma de cambiarlo.
    const vehiculos = vehiculosDe(rows);
    const motivos = motivosDe(rows, cierrePorLead);

    let leads = rows;
    if (input.vehiculoMarca) {
      leads = leads.filter((l) => l.vehiculo_marca === input.vehiculoMarca);
    }
    if (input.vehiculoModelo) {
      leads = leads.filter((l) => l.vehiculo_modelo === input.vehiculoModelo);
    }
    if (input.vehiculoAnio !== undefined) {
      leads = leads.filter((l) => l.vehiculo_anio === input.vehiculoAnio);
    }
    if (input.soloDuplicados) {
      leads = leads.filter((l) => involucrados.has(l.id));
    }
    if (input.conSesionActiva !== undefined) {
      leads = leads.filter((l) => sesionPorLead.has(l.id) === input.conSesionActiva);
    }
    if (input.etapa) {
      leads = leads.filter((l) => sesionPorLead.get(l.id)?.current_stage === input.etapa);
    }
    if (input.resultado) {
      leads = leads.filter((l) => cierrePorLead.get(l.id)?.resultado === input.resultado);
    }
    if (input.motivoPerdida) {
      leads = leads.filter((l) => cierrePorLead.get(l.id)?.motivo_perdida === input.motivoPerdida);
    }
    if (input.etiquetaId) {
      // Una consulta al pivot, no una por lead: devuelve los ids de golpe.
      const conEtiqueta = new Set(await this.deps.tags.listLeadIdsByTag(input.etiquetaId));
      leads = leads.filter((l) => conEtiqueta.has(l.id));
    }
    if (input.sinResponder) {
      // Solo los hilos de las sesiones que sobrevivieron a los demás filtros, y
      // en tandas: sin sesión abierta no hay nada esperando respuesta.
      const sessionIds = leads
        .map((l) => sesionPorLead.get(l.id)?.id)
        .filter((id): id is UUID => id !== undefined);
      const pendientesDeRespuesta = sesionesPendientes(
        await this.deps.messages.listBySessionIds(sessionIds),
      );
      leads = leads.filter((l) => {
        const sesion = sesionPorLead.get(l.id);
        return sesion !== undefined && pendientesDeRespuesta.has(sesion.id);
      });
    }

    const items: LeadListItem[] = leads.map((lead) => {
      const cierre = cierrePorLead.get(lead.id);
      return {
        leadId: lead.id,
        nombre: lead.nombre,
        telefono: lead.telefono,
        canalOrigen: lead.canal_origen,
        vehiculo: vehiculoDe(lead),
        sesionActiva: sesionPorLead.has(lead.id),
        currentStage: sesionPorLead.get(lead.id)?.current_stage ?? null,
        resultado: cierre?.resultado ?? null,
        motivoPerdida: cierre?.motivo_perdida ?? null,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
      };
    });

    const etiquetas: EtiquetaOpcion[] = catalogoEtiquetas
      .map((t) => ({ id: t.id, nombre: t.nombre, color: t.color }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return { items, pendingPairs: pendientes.length, vehiculos, motivos, etiquetas };
  }

  async getLeadDetail(leadId: UUID): Promise<LeadDetail> {
    const lead = await this.deps.leads.findById(leadId);
    if (!lead) throw new NotFoundError(`lead no encontrado: ${leadId}`, "lead", leadId);

    const [tags, sesiones, pendientes, fusiones, identificadores] = await Promise.all([
      this.deps.tags.listByLead(leadId),
      this.deps.sessions.listByLeadId(leadId),
      this.deps.candidates.list({ status: "pending" }),
      // Sin repo de merge la ficha sigue andando y no muestra el historial: la
      // implementación in-memory de los contratos no modela `admin_actions`.
      this.deps.merge?.listByLeadId(leadId) ?? Promise.resolve([]),
      this.deps.identificadores.listByLeadId(leadId),
    ]);

    const propios = pendientes.filter((c) => c.src_lead_id === leadId || c.dst_lead_id === leadId);
    const duplicados: DuplicadoPendiente[] = [];
    for (const c of propios) {
      const otherId = c.src_lead_id === leadId ? c.dst_lead_id : c.src_lead_id;
      const otherLead = await this.deps.leads.findById(otherId);
      if (!otherLead) continue; // huérfano imposible por FK; defensa
      duplicados.push({
        candidateId: c.id,
        otherLead,
        reasons: c.reasons,
        score: c.similarity_score,
        createdAt: c.created_at,
      });
    }

    return {
      lead,
      tags: tags.map((t) => ({ id: t.id, nombre: t.nombre, color: t.color, source: t.source })),
      sesiones,
      sesionActiva: sesiones.find((s) => s.resultado === null) ?? null,
      duplicados,
      fusiones,
      identificadores,
    };
  }

  async agregarIdentificador(input: AgregarIdentificadorInput): Promise<LeadIdentificador> {
    const lead = await this.deps.leads.findById(input.leadId);
    if (!lead) throw new NotFoundError(`lead no encontrado: ${input.leadId}`, "lead", input.leadId);

    const actuales = await this.deps.identificadores.listByLeadId(input.leadId);
    return this.deps.identificadores.create({
      lead_id: input.leadId,
      tipo: input.tipo,
      valor: input.valor,
      // Se guarda lo tipeado sólo cuando aporta algo: si coincide con el
      // normalizado, una segunda copia de la misma cadena es ruido.
      valor_original: input.valorOriginal === input.valor ? null : input.valorOriginal,
      principal: !actuales.some((i) => i.tipo === input.tipo),
      origen: "manual",
    });
  }

  async quitarIdentificador(input: QuitarIdentificadorInput): Promise<void> {
    // Se lista por lead y se busca adentro, en vez de borrar por id a secas:
    // `delete(id)` sin comprobar pertenencia deja que un id de otro lead —o
    // adivinado— se borre con el mismo permiso, y la RLS no lo frena porque
    // vendedor puede borrar identificadores de cualquier lead.
    const actuales = await this.deps.identificadores.listByLeadId(input.leadId);
    const propio = actuales.find((i) => i.id === input.identificadorId);
    if (!propio) {
      throw new NotFoundError(
        `identificador no encontrado en el lead: ${input.identificadorId}`,
        "lead_identificador",
        input.identificadorId,
      );
    }
    await this.deps.identificadores.delete(propio.id);
  }

  async updateLeadProfile(
    input: import("@/lib/validation/leads.schema").UpdateLeadProfileInput & {
      actorUserId: UUID;
    },
  ): Promise<{ lead: Lead; changedFields: string[] }> {
    const current = await this.deps.leads.findById(input.leadId);
    if (!current) {
      throw new NotFoundError(`lead no encontrado: ${input.leadId}`, "lead", input.leadId);
    }

    const requested = {
      nombre: input.nombre,
      email: input.email,
      direccion: input.direccion,
      vehiculo_marca: input.vehiculoMarca,
      vehiculo_modelo: input.vehiculoModelo,
      vehiculo_anio: input.vehiculoAnio,
      vehiculo_motor: input.vehiculoMotor,
    };
    const changedFields = Object.entries(requested)
      .filter(([field, value]) => current[field as keyof typeof requested] !== value)
      .map(([field]) => field);

    if (changedFields.length === 0) return { lead: current, changedFields };

    const patch = Object.fromEntries(
      Object.entries(requested).filter(([field]) => changedFields.includes(field)),
    );
    const lead = await this.deps.leads.update(current.id, patch);
    await this.deps.audit.recordAction({
      actorUserId: input.actorUserId,
      action: ADMIN_ACTIONS.LEAD_UPDATE,
      entityType: "lead",
      entityId: current.id,
      payload: { fields: changedFields },
    });
    return { lead, changedFields };
  }
}
