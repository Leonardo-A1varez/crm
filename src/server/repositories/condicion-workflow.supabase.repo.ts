import { InfraError } from "@/lib/errors";
import type { Grupo } from "@/lib/ui/condiciones";
import type { CampoCondicion, ConsultaCamposVivos } from "@/lib/workflows/condiciones";
import { CLAVE_INTENT_MENSAJE_AT } from "@/lib/workflows/contexto";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { ContextoRun } from "@/types/workflows";
import type {
  CatalogosCondicion,
  Coincidencias,
  CondicionWorkflowRepository,
  OpcionesCoincidencias,
} from "./condicion-workflow.repo";

/** Un turno clasificado, venga del LLM o de una regla. */
interface TurnoClasificado {
  intentId: string | null;
  en: string;
  /** Cuándo llegó el mensaje del turno (`mensajes.created_at`). */
  mensajeAt: string;
}

/**
 * Las lecturas de la condición contra Supabase.
 *
 * `leerCamposVivos` hace una consulta chica por campo pedido, todas por clave
 * (lead o sesión) y con `limit 1` donde hay que elegir una fila: nada que el
 * tope de 1.000 filas de PostgREST pueda recortar. Las etiquetas son todas las
 * de un lead, que son pocas por construcción.
 */
export class SupabaseCondicionWorkflowRepository implements CondicionWorkflowRepository {
  constructor(private readonly db: AppClient) {}

  async leerCamposVivos(consulta: ConsultaCamposVivos): Promise<ContextoRun> {
    const { leadId, campos } = consulta;
    if (!isUuid(leadId)) return {};
    const pide = (c: CampoCondicion) => campos.has(c);

    const necesitaSesion = pide("sesion.intent") || pide("sesion.precio_cotizado");
    const sesionId = necesitaSesion
      ? consulta.leadSessionId !== null && isUuid(consulta.leadSessionId)
        ? consulta.leadSessionId
        : await this.sesionMasReciente(leadId)
      : null;

    const lead: Record<string, unknown> = {};
    const sesion: Record<string, unknown> = {};
    const vehiculo: Record<string, unknown> = {};

    await Promise.all([
      pide("lead.etiquetas") &&
        this.etiquetas(leadId).then((v) => {
          lead["etiquetas"] = v;
        }),
      pide("lead.alta") &&
        this.alta(leadId).then((v) => {
          lead["alta"] = v;
        }),
      pide("lead.ultimo_mensaje") &&
        this.ultimoEntrante(leadId).then((v) => {
          lead["ultimo_mensaje"] = v;
        }),
      pide("vehiculo.marca") &&
        this.marcaPrincipal(leadId).then((v) => {
          vehiculo["marca"] = v;
        }),
      pide("sesion.intent") &&
        (sesionId === null
          ? Promise.resolve().then(() => {
              sesion["intent"] = null;
            })
          : this.ultimoIntent(sesionId).then((v) => {
              sesion["intent"] = v?.intentId ?? null;
              if (v) sesion[CLAVE_INTENT_MENSAJE_AT] = v.mensajeAt;
            })),
      pide("sesion.precio_cotizado") &&
        (sesionId === null
          ? Promise.resolve().then(() => {
              sesion["precio_cotizado"] = null;
            })
          : this.precioCotizado(sesionId).then((v) => {
              sesion["precio_cotizado"] = v;
            })),
    ]);

    const contexto: ContextoRun = {};
    if (Object.keys(lead).length > 0) contexto["lead"] = lead;
    if (Object.keys(sesion).length > 0) contexto["sesion"] = sesion;
    if (Object.keys(vehiculo).length > 0) contexto["vehiculo"] = vehiculo;
    return contexto;
  }

  async catalogos(): Promise<CatalogosCondicion> {
    const [intents, tags] = await Promise.all([
      this.db.from("intents").select("id, nombre, activo").order("nombre").range(0, 999),
      this.db.from("tags").select("id, nombre, color").order("nombre").range(0, 999),
    ]);
    if (intents.error) throw mapPostgrestError(intents.error, { resource: "intents" });
    if (tags.error) throw mapPostgrestError(tags.error, { resource: "tags" });
    return {
      intents: intents.data.map((i) => ({ id: i.id, nombre: i.nombre, activo: i.activo })),
      etiquetas: tags.data.map((t) => ({ id: t.id, nombre: t.nombre, color: t.color })),
    };
  }

  async coincidencias(arbol: Grupo, opciones: OpcionesCoincidencias): Promise<Coincidencias> {
    const { data, error } = await this.db.rpc("workflow_condicion_coincidencias", {
      p_arbol: arbol as never,
      p_ahora: opciones.ahora.toISOString(),
      p_zona: opciones.zona,
      p_muestra: opciones.muestra,
    });
    if (error) throw mapPostgrestError(error, { resource: "workflow_condicion" });
    const r = data as { total?: unknown; leads?: unknown } | null;
    if (r === null || typeof r.total !== "number" || !Array.isArray(r.leads)) {
      throw new InfraError("workflow_condicion_coincidencias devolvió otra forma", "postgrest");
    }
    return {
      total: r.total,
      leads: (r.leads as { id: string; nombre: string | null }[]).map((l) => ({
        id: l.id,
        nombre: l.nombre,
      })),
    };
  }

  private async sesionMasReciente(leadId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("lead_session")
      .select("id")
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return data?.id ?? null;
  }

  private async etiquetas(leadId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from("lead_tags")
      .select("tag_id")
      .eq("lead_id", leadId)
      .is("quitada_at", null)
      .range(0, 999);
    if (error) throw mapPostgrestError(error, { resource: "lead_tags" });
    return data.map((r) => r.tag_id);
  }

  private async alta(leadId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("leads")
      .select("created_at")
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "leads" });
    return data?.created_at ?? null;
  }

  /** El último entrante del lead, en cualquiera de sus conversaciones. */
  private async ultimoEntrante(leadId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("mensajes")
      .select("created_at, conversaciones!inner(lead_id)")
      .eq("conversaciones.lead_id", leadId)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "mensajes" });
    return data?.created_at ?? null;
  }

  /** El principal; entre iguales, el más viejo. Mismo orden que `lead-vehiculos`. */
  private async marcaPrincipal(leadId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("lead_vehiculos")
      .select("marca")
      .eq("lead_id", leadId)
      .order("principal", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_vehiculos" });
    return data?.marca ?? null;
  }

  private async precioCotizado(sesionId: string): Promise<number | null> {
    const { data, error } = await this.db
      .from("lead_session")
      .select("precio_cotizado")
      .eq("id", sesionId)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    const v = data?.precio_cotizado;
    return v === null || v === undefined ? null : Number(v);
  }

  /**
   * El intent del turno clasificado más nuevo de la sesión. Un turno lo
   * resuelve el LLM (`turn_classifications`) o una regla (`rule_executions`):
   * se mira el último de cada tabla y gana el más nuevo. Si el más nuevo no
   * reconoció ningún intent, no hay intent: no se cae al anterior.
   *
   * Devuelve también la hora del mensaje del turno: con ella el ejecutor la
   * compara con el intent que trae el disparo (`sinIntentMasViejo`).
   */
  private async ultimoIntent(sesionId: string): Promise<TurnoClasificado | null> {
    const [llm, regla] = await Promise.all([
      this.db
        .from("turn_classifications")
        .select("intent_id, created_at, mensajes!inner(lead_session_id, created_at)")
        .eq("mensajes.lead_session_id", sesionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.db
        .from("rule_executions")
        .select("matched_intent_id, created_at, mensajes!inner(lead_session_id, created_at)")
        .eq("mensajes.lead_session_id", sesionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (llm.error) throw mapPostgrestError(llm.error, { resource: "turn_classifications" });
    if (regla.error) throw mapPostgrestError(regla.error, { resource: "rule_executions" });
    const turnos: TurnoClasificado[] = [];
    if (llm.data) {
      turnos.push({
        intentId: llm.data.intent_id,
        en: llm.data.created_at,
        mensajeAt: llm.data.mensajes.created_at,
      });
    }
    if (regla.data) {
      turnos.push({
        intentId: regla.data.matched_intent_id,
        en: regla.data.created_at,
        mensajeAt: regla.data.mensajes.created_at,
      });
    }
    turnos.sort((a, b) => Date.parse(b.en) - Date.parse(a.en));
    return turnos[0] ?? null;
  }
}
