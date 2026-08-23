import { NotFoundError } from "@/lib/errors";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type {
  AgenteConfigRepository,
  AgenteConfigInsert,
} from "@/server/repositories/agente-config.repo";
import type { AgenteConfig, AgenteConfigValores, Horario } from "@/types/agente";
import { DIAS_SEMANA } from "@/types/agente";

export interface GuardarConfigInput {
  valores: AgenteConfigValores;
  actorUserId: string | null;
  nota?: string;
}

export interface RollbackInput {
  configId: string;
  actorUserId: string | null;
}

export interface AgenteConfigService {
  guardarYActivar(input: GuardarConfigInput): Promise<AgenteConfig>;
  rollback(input: RollbackInput): Promise<AgenteConfig>;
  historial(limit?: number): Promise<AgenteConfig[]>;
  activa(): Promise<AgenteConfig | null>;
}

/**
 * Lo mínimo que este servicio necesita del audit trail. No es
 * `AdminAuditService` (`recordAction`, camelCase): es un puerto propio y
 * angosto para no acoplar el servicio a esa interfaz concreta. El bootstrap
 * adapta el `AdminAuditService` real a esta forma.
 */
export interface AgenteConfigAuditPort {
  record(input: {
    action: string;
    entity_type: string;
    entity_id: string | null;
    payload: unknown;
    actorUserId: string | null;
  }): Promise<void>;
}

export interface AgenteConfigServiceDeps {
  repo: AgenteConfigRepository;
  audit: AgenteConfigAuditPort;
  configProvider: AgentConfigProvider;
}

const ACTION_ACTIVAR = "agente_config.activar";
const ENTITY_TYPE = "agente_config";

/**
 * Los campos escalares de `AgenteConfigValores`. `horario` y `escalar_palabras`
 * se comparan aparte: son estructuras, y `!==` sobre ellas daría "cambió"
 * siempre porque el repo entrega una copia nueva en cada lectura.
 */
const CAMPOS_ESCALARES = [
  "modelo",
  "instrucciones",
  "tono",
  "largo",
  "emojis",
  "descuento_max_pct",
  "max_pasos_tool",
  "ventana_contexto_mensajes",
  "umbral_resumen_turnos",
  "timeout_tool_ms",
  "tope_gasto_diario_usd",
  "politica_tope",
  "max_salientes_automaticos_24h",
  "escalar_umbral_intents",
  "escalar_cotizacion_desde",
  "horario_timezone",
  "plantilla_fuera_horario",
  "plantilla_escalado",
] as const satisfies readonly (keyof Omit<AgenteConfigValores, "horario" | "escalar_palabras">)[];

/**
 * Comparación por valor, día a día y rango a rango. Comparar `horario` por
 * referencia (`===` o incluso `JSON.stringify` sin normalizar orden de
 * claves) daría falso negativo cada vez que el objeto llega clonado — que es
 * siempre, porque el repo clona con `structuredClone` — y el audit mentiría
 * sobre qué cambió.
 */
function horariosIguales(a: Horario, b: Horario): boolean {
  for (const dia of DIAS_SEMANA) {
    const ra = a[dia] ?? [];
    const rb = b[dia] ?? [];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      if (ra[i]?.desde !== rb[i]?.desde || ra[i]?.hasta !== rb[i]?.hasta) return false;
    }
  }
  return true;
}

/**
 * Comparación posicional. El orden de `escalar_palabras` es significativo —
 * es el orden en que se evalúan contra el mensaje entrante y el que se ve en
 * los chips— así que reordenar la lista SÍ es un cambio a auditar.
 */
function palabrasIguales(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p === b[i]);
}

/** Nombres de los campos que difieren entre la activa (si hay) y los nuevos valores. Nunca valores. */
function camposCambiados(actual: AgenteConfigValores | null, nuevo: AgenteConfigValores): string[] {
  if (!actual) return [];

  const cambiados: string[] = [];
  for (const campo of CAMPOS_ESCALARES) {
    if (actual[campo] !== nuevo[campo]) cambiados.push(campo);
  }
  if (!palabrasIguales(actual.escalar_palabras, nuevo.escalar_palabras)) {
    cambiados.push("escalar_palabras");
  }
  if (!horariosIguales(actual.horario, nuevo.horario)) cambiados.push("horario");
  return cambiados;
}

/** Extrae solo los campos de dominio de una fila persistida, sin metadatos de versión. */
function soloValores(c: AgenteConfig): AgenteConfigValores {
  return {
    modelo: c.modelo,
    instrucciones: c.instrucciones,
    tono: c.tono,
    largo: c.largo,
    emojis: c.emojis,
    descuento_max_pct: c.descuento_max_pct,
    max_pasos_tool: c.max_pasos_tool,
    ventana_contexto_mensajes: c.ventana_contexto_mensajes,
    umbral_resumen_turnos: c.umbral_resumen_turnos,
    timeout_tool_ms: c.timeout_tool_ms,
    tope_gasto_diario_usd: c.tope_gasto_diario_usd,
    politica_tope: c.politica_tope,
    max_salientes_automaticos_24h: c.max_salientes_automaticos_24h,
    escalar_umbral_intents: c.escalar_umbral_intents,
    escalar_palabras: c.escalar_palabras,
    escalar_cotizacion_desde: c.escalar_cotizacion_desde,
    horario: c.horario,
    horario_timezone: c.horario_timezone,
    plantilla_fuera_horario: c.plantilla_fuera_horario,
    plantilla_escalado: c.plantilla_escalado,
  };
}

interface EjecutarGuardadoInput {
  valores: AgenteConfigValores;
  actorUserId: string | null;
  nota: string | null;
  rollbackDe: string | null;
}

export class DefaultAgenteConfigService implements AgenteConfigService {
  constructor(private readonly deps: AgenteConfigServiceDeps) {}

  async guardarYActivar(input: GuardarConfigInput): Promise<AgenteConfig> {
    return this.ejecutarGuardado({
      valores: input.valores,
      actorUserId: input.actorUserId,
      nota: input.nota ?? null,
      rollbackDe: null,
    });
  }

  async rollback(input: RollbackInput): Promise<AgenteConfig> {
    const origen = await this.deps.repo.findById(input.configId);
    if (!origen) {
      throw new NotFoundError(
        `config no encontrada: ${input.configId}`,
        "agente_config",
        input.configId,
      );
    }

    return this.ejecutarGuardado({
      valores: soloValores(origen),
      actorUserId: input.actorUserId,
      nota: `Rollback a la version ${origen.version}`,
      rollbackDe: origen.id,
    });
  }

  async historial(limit?: number): Promise<AgenteConfig[]> {
    return this.deps.repo.list(limit);
  }

  async activa(): Promise<AgenteConfig | null> {
    return this.deps.repo.findActiva();
  }

  /**
   * Núcleo compartido por `guardarYActivar` y `rollback`.
   *
   * Orden fijo, no reordenable: activar → auditar → invalidar cache.
   *
   * Si el audit fallara ANTES de activar, quedaría un registro de un cambio
   * que nunca ocurrió. Si `invalidar()` corriera antes de que el audit
   * confirme, un cache recién invalidado serviría una config cuya activación
   * todavía no quedó registrada. Auditar después de activar y antes de
   * invalidar hace que, si el audit falla, la config ya esté activa (el
   * fallo es visible, no silencioso) y el cache no se invalide con un
   * registro de auditoría a medias.
   */
  private async ejecutarGuardado(input: EjecutarGuardadoInput): Promise<AgenteConfig> {
    const { repo, audit, configProvider } = this.deps;

    const activaAntes = await repo.findActiva();
    const campos_cambiados = camposCambiados(
      activaAntes ? soloValores(activaAntes) : null,
      input.valores,
    );

    const version = await repo.siguienteVersion();
    const insert: AgenteConfigInsert = {
      ...input.valores,
      version,
      nota: input.nota,
      rollback_de: input.rollbackDe,
      creada_por: input.actorUserId,
    };
    const creada = await repo.crear(insert);
    const activada = await repo.activar(creada.id);

    await audit.record({
      action: ACTION_ACTIVAR,
      entity_type: ENTITY_TYPE,
      entity_id: activada.id,
      payload: {
        version: activada.version,
        version_anterior: activaAntes?.version ?? null,
        campos_cambiados,
        rollback_de: input.rollbackDe,
      },
      actorUserId: input.actorUserId,
    });

    configProvider.invalidar();

    return activada;
  }
}
