import { BudgetExceededError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { compilarAudiencia, type AudienciaCompilada } from "@/lib/difusion/audiencia";
import { SIN_TECHO, cupoParaPlanificar, type TopeMensajeria } from "@/lib/difusion/cupo";
import { eventoDifusionProgramada, eventoDifusionReanudada } from "@/lib/difusion/eventos";
import { enmascararTelefono } from "@/lib/difusion/mascara";
import {
  MOTIVO_EXCLUSION,
  esMotivoEximible,
  type CategoriaPlantilla,
  type ContenidoEnvio,
  type Difusion,
  type DifusionEnvio,
  type EstadoDifusion,
  type EstadoEnvio,
  type ModoAudiencia,
  type MotivoExclusion,
  type RutaEnvio,
} from "@/lib/difusion/modelo";
import {
  planificarDifusion,
  type EntradaPlanificador,
  type PlanDifusion,
  type TandaPlanificada,
} from "@/lib/difusion/planificador";
import {
  CAMPOS_PARAMETRO,
  TextoLibreSchema,
  type CampoParametro,
  type ParametroPlantilla,
} from "@/lib/difusion/parametros";
import type { DatosInterpolacion } from "@/lib/workflows/variables";
import type { Logger } from "@/lib/observability/logger";
import type { Grupo } from "@/lib/ui/condiciones";
import { LIMITE_MAX_PAGINA } from "@/server/repositories/_paginacion";
import type { DifusionAudienciaRepository } from "@/server/repositories/difusion-audiencia.repo";
import {
  filasDesdePlan,
  resumenVacio,
  type ConteoMuestra,
  type DifusionEnviosRepository,
  type FalloPorCodigo,
} from "@/server/repositories/difusion-envios.repo";
import type { DifusionProgramacionRepository } from "@/server/repositories/difusion-programacion.repo";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { DifusionesRepository } from "@/server/repositories/difusiones.repo";
import type { AdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { UsersRepository } from "@/server/repositories/users.repo";
import type { UUID } from "@/types/entities";
import { aCandidato, leerContextoPlan, type ContextoPlan } from "./contexto-plan";

/**
 * Difusión de punta a punta, del lado del servidor: el borrador, el alcance
 * que se ve mientras se arma, la programación y lo que se puede hacer con una
 * difusión que ya salió.
 *
 * No manda nada. Programar escribe el plan y avisa al motor que drena la cola
 * (`difusion/programada`), que es otra pieza. Todo lo que dice cuántos, a
 * quién y cuándo sale del planificador (`src/lib/difusion/planificador.ts`):
 * este servicio junta lo que el planificador necesita y lo devuelve en una
 * forma que la pantalla puede dibujar.
 */

export type LecturaTope =
  | { estado: "ok"; tope: TopeMensajeria }
  | { estado: "sin-dato"; motivo: string };

export type EventoDifusionProgramada = ReturnType<typeof eventoDifusionProgramada>;
export type EventoDifusionReanudada = ReturnType<typeof eventoDifusionReanudada>;

export interface DifusionServiceDeps {
  /**
   * `admin_actions`: eximir una exclusión (en negociación, tope de frecuencia)
   * queda registrado con quién lo hizo (PRD de difusión §7.3: "la exención es
   * explícita, por campaña, y queda en la auditoría"). Obligatorio.
   */
  audit: Pick<AdminAuditRepository, "create">;
  difusiones: DifusionesRepository;
  envios: DifusionEnviosRepository;
  supresiones: DifusionSupresionesRepository;
  audiencia: DifusionAudienciaRepository;
  programacion: DifusionProgramacionRepository;
  tags: Pick<TagsRepository, "list">;
  usuarios: Pick<UsersRepository, "list">;
  /** El escalón de mensajería que Meta devuelve por API (`SaludWhatsApp.limite`). */
  leerTopeMensajeria: () => Promise<LecturaTope>;
  /** `agente_config.max_salientes_automaticos_24h`: el mismo tope que los workflows. */
  leerMaxSalientes24h: () => Promise<number>;
  /**
   * Aviso directo al motor. Best-effort: la fila de `event_outbox` ya quedó
   * escrita en la misma transacción que el plan, y el cron la reenvía.
   */
  avisarProgramada: (evento: EventoDifusionProgramada) => Promise<void>;
  /**
   * Aviso al motor de que una difusión en revisión se reanudó. Best-effort
   * igual: si falla, el cron del motor la retoma en su próxima pasada.
   */
  avisarReanudada?: (evento: EventoDifusionReanudada) => Promise<void>;
  /**
   * Los mismos datos con que el motor resuelve las variables al mandar. Sin
   * él, `valoresDeVariables` no devuelve nada y la pantalla no afirma que a
   * alguien le falte un dato.
   */
  datosDelLead?: (leadId: UUID, campos: ReadonlySet<CampoParametro>) => Promise<DatosInterpolacion>;
  /**
   * El texto de cada respuesta (por el wamid del entrante, en `mensajes`) y el
   * nombre de cada lead. Sin él, el detalle cuenta las respuestas pero no las
   * lista.
   */
  leerRespuestas?: (
    wamids: readonly string[],
    leadIds: readonly UUID[],
  ) => Promise<LecturaRespuestas>;
  logger: Logger;
  ahora?: () => Date;
}

// -------------------------------------------------------------------------
// Entradas
// -------------------------------------------------------------------------

export interface CrearBorradorInput {
  nombre: string;
  audiencia: Grupo;
  /** Mandarle a toda la base, a propósito. Va con el árbol vacío. */
  todaLaBase: boolean;
  modo: ModoAudiencia;
  incluirEnNegociacion: boolean;
  exentaTopeFrecuencia: boolean;
}

export interface GuardarBorradorInput {
  nombre?: string;
  audiencia?: Grupo;
  todaLaBase?: boolean;
  modo?: ModoAudiencia;
  incluirEnNegociacion?: boolean;
  exentaTopeFrecuencia?: boolean;
  /** `null` saca la plantilla elegida. */
  plantilla?: {
    nombre: string;
    categoria: CategoriaPlantilla;
    /** El código con que Meta la aprobó: `es`, `es_AR`. */
    idioma: string;
    /** Una por `{{n}}`, en orden. */
    parametros: ParametroPlantilla[];
  } | null;
  /**
   * La versión en texto libre para quien tiene la ventana abierta, con las
   * variables de la plantilla (`{{lead.nombre}}`). `null` la saca: todos
   * reciben la plantilla.
   */
  textoLibre?: string | null;
}

export interface AlcanceInput {
  audiencia: Grupo;
  todaLaBase: boolean;
  incluirEnNegociacion: boolean;
  exentaTopeFrecuencia: boolean;
  /** `null` mientras no se eligió plantilla: se calcula como marketing, que es la que más excluye. */
  plantillaCategoria: CategoriaPlantilla | null;
  /** La difusión tiene texto libre: quien tiene la ventana abierta lo recibe en vez de la plantilla. */
  textoLibre?: boolean;
  /** Qué página de la lista de destinatarios devolver. */
  muestra: { desde: number; limite: number };
  /** La difusión que se está armando: no se compara contra sí misma. */
  difusionId?: UUID | null;
  /** Calcular la diferencia contra el envío anterior (el pre-vuelo la muestra). */
  conDiff?: boolean;
}

export interface ProgramarInput {
  /** Null = sin muestra: sale todo el plan. */
  canaryTamano: number | null;
}

// -------------------------------------------------------------------------
// Salidas: serializables, sin `Date` —cruzan a la pantalla—
// -------------------------------------------------------------------------

export interface ExclusionVista {
  motivo: MotivoExclusion;
  /** Si está aplicada, cuántos excluye; si está eximida, a cuántos excluiría. */
  cantidad: number;
  aplicada: boolean;
  /** La deja desmarcar el backend: sólo en negociación y tope de frecuencia. */
  eximible: boolean;
}

export type CupoVista =
  | {
      estado: "ok";
      tope: TopeMensajeria;
      /** Contado con los envíos de este CRM: Meta no expone el uso. */
      usado24h: number;
      reserva: number;
      restante: number;
      /** Plantillas por tanda de 24 h, según el planificador. */
      porTanda: number;
      /** Plantillas que pide esta difusión. */
      solicitado: number;
      /** `false` = lo que pide por plantilla no entra en ninguna tanda. */
      alcanza: boolean;
    }
  | { estado: "sin-dato"; motivo: string; solicitado: number };

export interface TandaVista {
  tanda: number;
  desde: string;
  porPlantilla: number;
  porVentanaAbierta: number;
}

export interface DestinatarioVista {
  leadId: UUID;
  nombre: string;
  /** Enmascarado: el número entero no sale del servidor. */
  telefono: string;
  vehiculo: string | null;
  ruta: RutaEnvio;
  /** Qué le sale según el plan; el motor vuelve a mirar la ventana al mandar. */
  contenido: ContenidoEnvio;
  tanda: number;
  /** Contra el envío anterior; `null` si no se pidió o no hay con qué comparar. */
  diff: "nuevo" | "repite" | null;
}

export interface DiffVista {
  referencia: { id: UUID; nombre: string };
  nuevos: number;
  repiten: number;
  yaNoCalifican: number;
}

export interface Alcance {
  calculadoAt: string;
  /** Los que coinciden con las condiciones, antes de excluir. */
  audienciaInicial: number;
  destinatarios: number;
  porRuta: Record<RutaEnvio, number>;
  /** Texto libre (gratis) o plantilla, según el plan. */
  porContenido: Record<ContenidoEnvio, number>;
  /** Los diez motivos del planificador, en su orden de precedencia. */
  exclusiones: ExclusionVista[];
  /** Se calculó suponiendo una plantilla de marketing porque todavía no se eligió una. */
  categoriaSupuesta: boolean;
  cupo: CupoVista;
  /** Vacío si el cupo no alcanza o no se pudo leer: no se inventa un reparto. */
  tandas: TandaVista[];
  /** Una página de los destinatarios, en el orden en que salen. */
  muestra: DestinatarioVista[];
  muestraDesde: number;
  diff: DiffVista | null;
}

export interface ResultadoProgramar {
  difusionId: UUID;
  audienciaInicial: number;
  destinatarios: number;
  tandas: number;
  /** Ya estaba programada: no se reescribió nada. */
  yaEstabaProgramada: boolean;
}

export interface ResultadoCancelar {
  /** Los que estaban en cola y se frenaron. */
  cancelados: number;
  /** Los que ya habían llegado a Meta: detener no los recupera. */
  yaSalieron: number;
}

export interface DifusionResumen {
  id: UUID;
  nombre: string;
  estado: EstadoDifusion;
  plantilla: string | null;
  /** Filas que nacieron en cola: el plan, no lo que salió. */
  destinatarios: number;
  /** Llegaron a un teléfono: entregados más leídos. */
  entregados: number;
  leidos: number;
  fallidos: number;
  enCola: number;
  creadaAt: string;
  programadaPara: string | null;
}

export interface ListadoDifusiones {
  difusiones: DifusionResumen[];
  /** Hay más difusiones de las que se muestran (`LIMITE_LISTADO`): la lista es la de las más recientes. */
  hayMas: boolean;
  suprimidos: number;
  destinatarios30d: number;
  /** `false` si hubo más difusiones en 30 días de las que se leyeron: la suma es un piso. */
  destinatarios30dCompleto: boolean;
}

export interface DifusionVista {
  id: UUID;
  nombre: string;
  estado: EstadoDifusion;
  audiencia: Grupo;
  audienciaTodaLaBase: boolean;
  audienciaModo: ModoAudiencia;
  plantillaNombre: string | null;
  plantillaCategoria: CategoriaPlantilla | null;
  plantillaIdioma: string | null;
  plantillaParametros: ParametroPlantilla[];
  /** La versión en texto libre, o `null`: todos reciben la plantilla. */
  textoLibre: string | null;
  incluirEnNegociacion: boolean;
  exentaTopeFrecuencia: boolean;
  canaryTamano: number | null;
  programadaPara: string | null;
  iniciadaAt: string | null;
  finalizadaAt: string | null;
  motivoDetencion: string | null;
  /** Por qué el sistema la pasó a revisión; `null` = la pausó una persona. */
  motivoRevision: string | null;
  /** La frenó una persona; `false` con estado detenida = la frenó el sistema. */
  detenidaPorPersona: boolean;
  creadaAt: string;
}

export interface TandaPersistidaVista {
  tanda: number;
  desde: string;
  total: number;
  enCola: number;
  porPlantilla: number;
}

export interface LecturaRespuestas {
  textos: Map<string, { contenido: string | null; tipo: string }>;
  nombres: Map<UUID, string>;
}

export interface RespuestaVista {
  leadId: UUID | null;
  nombre: string | null;
  /** `null` si el mensaje ya no está (se purgó la sesión) o no se pudo leer. */
  texto: string | null;
  tipo: string | null;
  respondidoAt: string;
}

/** Lo que salió en la muestra, contado por estado y código de Meta. */
export interface MuestraVista {
  tamano: number;
  /** Cuándo la frenó el motor para revisarla. */
  salioAt: string;
  /** Cuándo una persona reanudó. `null` = sigue en revisión (o se detuvo). */
  continuadaAt: string | null;
  conteo: ConteoMuestra[];
}

export interface DetalleDifusion {
  difusion: DifusionVista;
  conteo: {
    total: number;
    porEstado: Record<EstadoEnvio, number>;
    porMotivo: Record<MotivoExclusion, number>;
  };
  tandas: TandaPersistidaVista[];
  fallos: FalloPorCodigo[];
  respuestas: { total: number; recientes: RespuestaVista[] };
  /** Lo reservado en la ventana reciente: de ahí sale el ritmo real. */
  avance: { reservadosEnVentana: number; ventanaMs: number; calculadoAt: string };
  muestra: MuestraVista | null;
  /** Audiencia dinámica: cuántos entraron después de programar (altas, en cola o excluidas). */
  altasDinamicas: number;
}

export interface OpcionCatalogo {
  valor: string;
  etiqueta: string;
  color?: string;
}

export interface CatalogosAudienciaVista {
  etiquetas: OpcionCatalogo[];
  vendedores: OpcionCatalogo[];
  /** Difusiones que ya salieron: las que se pueden usar como "campaña previa". */
  campanias: OpcionCatalogo[];
}

export interface DifusionService {
  crearBorrador(input: CrearBorradorInput, actorId: UUID): Promise<Difusion>;
  guardarBorrador(id: UUID, patch: GuardarBorradorInput, actorId: UUID): Promise<Difusion>;
  calcularAlcance(input: AlcanceInput): Promise<Alcance>;
  programar(id: UUID, input: ProgramarInput): Promise<ResultadoProgramar>;
  pausar(id: UUID): Promise<Difusion>;
  reanudar(id: UUID): Promise<Difusion>;
  cancelar(id: UUID, input: { motivo: string; actorId: UUID }): Promise<ResultadoCancelar>;
  listar(): Promise<ListadoDifusiones>;
  detalle(id: UUID): Promise<DetalleDifusion | null>;
  estadoCupo(): Promise<CupoVista>;
  catalogosAudiencia(): Promise<CatalogosAudienciaVista>;
  /**
   * Lo que cada lead tiene para las variables de la plantilla, para la vista
   * previa del paso «Mensaje». Hasta `MAX_VALORES_MUESTRA` leads.
   */
  valoresDeVariables(leadIds: readonly UUID[]): Promise<Record<UUID, ValoresDeLead>>;
}

/** Por dato del lead; un dato que no tiene no aparece. */
export type ValoresDeLead = Partial<Record<CampoParametro, string>>;

/** Leads por pedido de valores: la muestra que se ve en pantalla. */
export const MAX_VALORES_MUESTRA = 200;

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
/** Difusiones que muestra el listado. */
export const LIMITE_LISTADO = 100;
/** Filas de la lista de destinatarios por pedido. */
export const MUESTRA_MAX = 200;
/** Difusiones recientes entre las que se busca la anterior para comparar. */
const RECIENTES_PARA_DIFF = 50;
export const ACCION_EXCLUSION_EXIMIDA = "difusion.exclusion_eximida";
export const ACCION_EXCLUSION_RESTITUIDA = "difusion.exclusion_restituida";
/** Cuántas respuestas lista el detalle; el total se cuenta aparte. */
const RESPUESTAS_EN_DETALLE = 20;
/**
 * La ventana con que se mide el ritmo real. Decisión propia: cinco minutos
 * alisan los huecos entre lotes del motor sin arrastrar una tanda de ayer.
 */
const VENTANA_RITMO_MS = 5 * 60_000;
/** Difusiones que se ofrecen como "campaña previa". */
const LIMITE_CAMPANIAS = 200;

const ESTADO_LEGIBLE: Record<EstadoDifusion, string> = {
  borrador: "en borrador",
  programada: "programada",
  enviando: "enviándose",
  en_revision: "en revisión",
  completada: "completada",
  detenida: "detenida",
};

interface OpcionesPlan {
  plantilla: { categoria: CategoriaPlantilla };
  textoLibre: boolean;
  incluirEnNegociacion: boolean;
  exentaTopeFrecuencia: boolean;
}

export class DefaultDifusionService implements DifusionService {
  private readonly ahora: () => Date;

  constructor(private readonly deps: DifusionServiceDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
  }

  async crearBorrador(input: CrearBorradorInput, actorId: UUID): Promise<Difusion> {
    const d = await this.deps.difusiones.create({
      nombre: input.nombre.trim(),
      audiencia: input.audiencia,
      audiencia_toda_la_base: input.todaLaBase,
      audiencia_modo: input.modo,
      incluir_en_negociacion: input.incluirEnNegociacion,
      exenta_tope_frecuencia: input.exentaTopeFrecuencia,
      creada_por: actorId,
    });
    await this.auditarExenciones(
      d.id,
      actorId,
      { en_negociacion: false, cap_frecuencia: false },
      { en_negociacion: d.incluir_en_negociacion, cap_frecuencia: d.exenta_tope_frecuencia },
    );
    return d;
  }

  async guardarBorrador(id: UUID, patch: GuardarBorradorInput, actorId: UUID): Promise<Difusion> {
    const actual = await this.exigir(id);
    if (actual.estado !== "borrador") {
      throw new ConflictError(
        "La difusión ya no es un borrador: lo que se programó no se edita.",
        "estado_difusion",
      );
    }
    // Antes de guardar: una exención que se aplicó sin quedar registrada es
    // lo que el PRD dice que no pasa; un registro de algo que después no se
    // guardó sólo dice que alguien lo intentó.
    // Sólo variables que el motor carga, y dentro de lo que Meta acepta. Se
    // valida antes de auditar: una edición rechazada no deja rastro.
    const textoLibre =
      patch.textoLibre === undefined || patch.textoLibre === null
        ? patch.textoLibre
        : validarTextoLibre(patch.textoLibre);
    await this.auditarExenciones(
      id,
      actorId,
      {
        en_negociacion: actual.incluir_en_negociacion,
        cap_frecuencia: actual.exenta_tope_frecuencia,
      },
      {
        en_negociacion: patch.incluirEnNegociacion ?? actual.incluir_en_negociacion,
        cap_frecuencia: patch.exentaTopeFrecuencia ?? actual.exenta_tope_frecuencia,
      },
    );
    return this.deps.difusiones.update(id, {
      nombre: patch.nombre?.trim(),
      audiencia: patch.audiencia,
      audiencia_toda_la_base: patch.todaLaBase,
      audiencia_modo: patch.modo,
      incluir_en_negociacion: patch.incluirEnNegociacion,
      exenta_tope_frecuencia: patch.exentaTopeFrecuencia,
      ...(textoLibre === undefined ? {} : { texto_libre: textoLibre }),
      ...(patch.plantilla === undefined
        ? {}
        : {
            plantilla_nombre: patch.plantilla?.nombre ?? null,
            plantilla_categoria: patch.plantilla?.categoria ?? null,
            plantilla_idioma: patch.plantilla?.idioma ?? null,
            plantilla_parametros: patch.plantilla?.parametros ?? [],
          }),
    });
  }

  async calcularAlcance(input: AlcanceInput): Promise<Alcance> {
    // Primero la audiencia: un árbol vacío o a medias se rechaza sin tocar la base.
    const compilada = compilarAudiencia(input.audiencia, { todaLaBase: input.todaLaBase });
    const ahora = this.ahora();
    const ctx = await this.contexto(compilada, ahora);

    const opciones: OpcionesPlan = {
      plantilla: { categoria: input.plantillaCategoria ?? "marketing" },
      textoLibre: input.textoLibre ?? false,
      incluirEnNegociacion: input.incluirEnNegociacion,
      exentaTopeFrecuencia: input.exentaTopeFrecuencia,
    };
    const { plan, cupo } = this.planificar(ctx, opciones, ahora);
    // A cuántos excluiría una exención que se levantó: se ve tachado en la pantalla.
    const sinExenciones =
      input.incluirEnNegociacion || input.exentaTopeFrecuencia
        ? this.planificar(
            ctx,
            { ...opciones, incluirEnNegociacion: false, exentaTopeFrecuencia: false },
            ahora,
          ).plan
        : plan;

    const diff = input.conDiff
      ? await this.diffContraAnterior(plan, input.difusionId ?? null)
      : null;
    const porLead = new Map(ctx.candidatos.map((c) => [c.leadId, c]));
    const desde = Math.max(0, Math.floor(input.muestra.desde));
    const limite = Math.min(Math.max(1, Math.floor(input.muestra.limite)), MUESTRA_MAX);

    return {
      calculadoAt: ahora.toISOString(),
      audienciaInicial: plan.audienciaInicial,
      destinatarios: plan.destinatarios.length,
      porRuta: plan.porRuta,
      porContenido: plan.porContenido,
      exclusiones: MOTIVO_EXCLUSION.map((motivo) => {
        const eximida =
          (motivo === "en_negociacion" && input.incluirEnNegociacion) ||
          (motivo === "cap_frecuencia" && input.exentaTopeFrecuencia);
        return {
          motivo,
          cantidad: (eximida ? sinExenciones : plan).exclusionesPorMotivo[motivo],
          aplicada: !eximida,
          eximible: esMotivoEximible(motivo),
        };
      }),
      categoriaSupuesta: input.plantillaCategoria === null,
      cupo,
      tandas: cupo.estado === "ok" && cupo.alcanza ? plan.tandas.map(vistaTanda) : [],
      muestra: plan.destinatarios.slice(desde, desde + limite).map((d) => {
        const c = porLead.get(d.leadId);
        return {
          leadId: d.leadId,
          nombre: c?.nombre ?? "",
          telefono: enmascararTelefono(d.telefono),
          vehiculo: c?.vehiculo ?? null,
          ruta: d.ruta,
          contenido: d.contenido,
          tanda: d.tanda,
          diff: diff?.porLead.get(d.leadId) ?? null,
        };
      }),
      muestraDesde: desde,
      diff: diff?.vista ?? null,
    };
  }

  async programar(id: UUID, input: ProgramarInput): Promise<ResultadoProgramar> {
    const d = await this.exigir(id);
    if (d.estado === "detenida" || d.estado === "completada") {
      throw new ConflictError(
        `La difusión está ${ESTADO_LEGIBLE[d.estado]}: no se vuelve a programar.`,
        "estado_difusion",
      );
    }
    if (d.estado !== "borrador") return this.yaProgramada(d);

    if (d.plantilla_nombre === null || d.plantilla_categoria === null) {
      throw new ValidationError(
        "Falta elegir la plantilla: sin ella no hay qué mandarle a quien no tiene la ventana abierta.",
      );
    }
    if (d.plantilla_idioma === null) {
      throw new ValidationError(
        "Falta el idioma de la plantilla: Meta la aprueba por idioma y sin él no sabe cuál mandar. Volvé a elegirla.",
      );
    }
    const compilada = compilarAudiencia(d.audiencia, { todaLaBase: d.audiencia_toda_la_base });
    const ahora = this.ahora();
    const ctx = await this.contexto(compilada, ahora);
    if (ctx.tope.estado !== "ok") {
      throw new ValidationError(
        `No se pudo leer el nivel de mensajería de Meta, y sin él no se sabe cuántos entran por día: ${ctx.tope.motivo}`,
      );
    }

    // Sin red: si no hay cupo, el planificador lanza BudgetExceededError y no
    // se escribe nada.
    const plan = planificarDifusion({
      ...this.entrada(
        ctx,
        {
          plantilla: { categoria: d.plantilla_categoria },
          textoLibre: d.texto_libre !== null,
          incluirEnNegociacion: d.incluir_en_negociacion,
          exentaTopeFrecuencia: d.exenta_tope_frecuencia,
        },
        ahora,
      ),
      cupo: cupoParaPlanificar({ tope: ctx.tope.tope, usado24h: ctx.usado24h }),
    });

    const n = plan.destinatarios.length;
    if (n === 0) {
      throw new ValidationError(
        "Todos los de la audiencia quedan excluidos: no hay a quién mandarle.",
      );
    }
    const canary = input.canaryTamano;
    if (canary !== null && (!Number.isInteger(canary) || canary < 1 || canary >= n)) {
      throw new ValidationError(
        n < 2
          ? "Con un solo destinatario no hay muestra que revisar: desmarcá la muestra."
          : `La muestra va de 1 a ${n - 1}: tiene que quedar alguien para después de revisarla.`,
      );
    }

    try {
      const r = await this.deps.programacion.programar({
        difusionId: id,
        programadaPara: ahora,
        canaryTamano: canary,
        filas: filasDesdePlan(id, plan),
      });
      await this.avisar({
        difusionId: id,
        programadaPara: ahora,
        audienciaInicial: r.audienciaInicial,
        destinatarios: r.destinatarios,
      });
      return {
        difusionId: id,
        audienciaInicial: r.audienciaInicial,
        destinatarios: r.destinatarios,
        tandas: plan.tandas.length,
        yaEstabaProgramada: false,
      };
    } catch (e) {
      // Dos confirmaciones a la vez: la segunda choca con la primera. Si la
      // difusión ya quedó programada, el pedido se cumplió.
      if (e instanceof ConflictError) {
        const releida = await this.deps.difusiones.findById(id);
        if (releida && releida.estado !== "borrador") return this.yaProgramada(releida);
      }
      throw e;
    }
  }

  async pausar(id: UUID): Promise<Difusion> {
    const d = await this.exigir(id);
    // Condicional: si el motor la terminó o la frenó entre la lectura y el
    // cambio, no se pisa lo que decidió.
    const pausada =
      d.estado === "enviando"
        ? await this.deps.difusiones.actualizarSiEstado(id, ["enviando"], {
            estado: "en_revision",
            motivo_revision: null,
          })
        : null;
    if (pausada) return pausada;
    const actual = await this.exigir(id);
    throw new ConflictError(
      `Sólo se pausa una difusión que se está enviando; esta está ${ESTADO_LEGIBLE[actual.estado]}.`,
      "estado_difusion",
    );
  }

  async reanudar(id: UUID): Promise<Difusion> {
    const d = await this.exigir(id);
    const reanudada =
      d.estado === "en_revision"
        ? await this.deps.difusiones.actualizarSiEstado(id, ["en_revision"], {
            estado: "enviando",
            motivo_revision: null,
            // La primera reanudación después de la muestra es "se continuó".
            ...(d.canary_revisado_at !== null && d.canary_continuada_at === null
              ? { canary_continuada_at: this.ahora() }
              : {}),
          })
        : null;
    if (!reanudada) {
      const actual = await this.exigir(id);
      throw new ConflictError(
        `Sólo se reanuda una difusión en revisión; esta está ${ESTADO_LEGIBLE[actual.estado]}.`,
        "estado_difusion",
      );
    }
    if (this.deps.avisarReanudada) {
      try {
        await this.deps.avisarReanudada(eventoDifusionReanudada(id, this.ahora()));
      } catch (e) {
        // El cron del motor la retoma igual en su próxima pasada.
        this.deps.logger.warn("difusion.aviso_reanudada_fallido", {
          difusionId: id,
          tipo: e instanceof Error ? e.name : typeof e,
        });
      }
    }
    return reanudada;
  }

  async cancelar(id: UUID, input: { motivo: string; actorId: UUID }): Promise<ResultadoCancelar> {
    const motivo = input.motivo.trim();
    if (motivo.length < 1 || motivo.length > 500) {
      throw new ValidationError("El motivo de la detención va de 1 a 500 caracteres.");
    }
    const d = await this.exigir(id);
    if (d.estado === "borrador") {
      throw new ConflictError(
        "Un borrador no se detiene: todavía no salió nada.",
        "estado_difusion",
      );
    }
    if (d.estado === "completada") {
      throw new ConflictError(
        "La difusión ya terminó: no queda nada en cola para detener.",
        "estado_difusion",
      );
    }
    // Primero el estado, para que el motor deje de tomar tandas; después la cola.
    // Si lo segundo falla, detener de nuevo lo completa sin tocar el motivo.
    if (d.estado !== "detenida") {
      await this.deps.difusiones.update(id, {
        estado: "detenida",
        motivo_detencion: motivo,
        detenida_por: input.actorId,
        finalizada_at: this.ahora(),
      });
    }
    return this.deps.envios.cancelarPendientes(id);
  }

  async listar(): Promise<ListadoDifusiones> {
    const ahora = this.ahora();
    const [todas, suprimidos] = await Promise.all([
      this.deps.difusiones.list({ limite: LIMITE_MAX_PAGINA }),
      this.deps.supresiones.contarActivas(),
    ]);
    const desde30 = ahora.getTime() - 30 * DIA_MS;
    const visibles = todas.slice(0, LIMITE_LISTADO);
    const ultimos30 = todas.filter((d) => d.created_at.getTime() >= desde30);
    const ids = [...new Set([...visibles, ...ultimos30].map((d) => d.id))];
    const resumen = await this.deps.envios.resumenPorDifusiones(ids);
    const destinatariosDe = (id: UUID) => {
      const r = resumen.get(id) ?? resumenVacio();
      return r.total - r.porEstado.excluido;
    };

    return {
      difusiones: visibles.map((d) => {
        const r = resumen.get(d.id) ?? resumenVacio();
        return {
          id: d.id,
          nombre: d.nombre,
          estado: d.estado,
          plantilla: d.plantilla_nombre,
          destinatarios: r.total - r.porEstado.excluido,
          entregados: r.porEstado.entregado + r.porEstado.leido,
          leidos: r.porEstado.leido,
          fallidos: r.porEstado.fallido,
          enCola: r.porEstado.en_cola,
          creadaAt: d.created_at.toISOString(),
          programadaPara: d.programada_para?.toISOString() ?? null,
        };
      }),
      hayMas: todas.length > LIMITE_LISTADO,
      suprimidos,
      destinatarios30d: ultimos30.reduce((n, d) => n + destinatariosDe(d.id), 0),
      // Si se leyó el máximo y todas son de los últimos 30 días, puede haber más.
      destinatarios30dCompleto: !(
        todas.length === LIMITE_MAX_PAGINA && ultimos30.length === todas.length
      ),
    };
  }

  async detalle(id: UUID): Promise<DetalleDifusion | null> {
    const d = await this.deps.difusiones.findById(id);
    if (!d) return null;
    const ahora = this.ahora();
    const [
      conteo,
      tandas,
      fallos,
      respondidos,
      totalRespuestas,
      reservados,
      conteoMuestra,
      altasDinamicas,
    ] = await Promise.all([
      this.deps.envios.contarPorDifusion(id),
      this.deps.envios.tandasPorDifusion(id),
      this.deps.envios.fallosPorCodigo(id),
      this.deps.envios.respondidos(id, RESPUESTAS_EN_DETALLE),
      this.deps.envios.contarRespondidos(id),
      this.deps.envios.contarReservadosDesde(id, new Date(ahora.getTime() - VENTANA_RITMO_MS)),
      d.canary_tamano !== null && d.canary_revisado_at !== null
        ? this.deps.envios.conteoMuestra(id, d.canary_revisado_at)
        : Promise.resolve(null),
      d.audiencia_modo === "dinamica" ? this.deps.envios.contarAltas(id) : Promise.resolve(0),
    ]);
    const recientes = await this.respuestasVista(respondidos);
    return {
      difusion: vistaDifusion(d),
      conteo: { total: conteo.total, porEstado: conteo.porEstado, porMotivo: conteo.porMotivo },
      tandas: tandas.map((t) => ({
        tanda: t.tanda,
        desde: t.desde.toISOString(),
        total: t.total,
        enCola: t.enCola,
        porPlantilla: t.porPlantilla,
      })),
      fallos,
      respuestas: { total: totalRespuestas, recientes },
      avance: {
        reservadosEnVentana: reservados,
        ventanaMs: VENTANA_RITMO_MS,
        calculadoAt: ahora.toISOString(),
      },
      muestra:
        conteoMuestra !== null && d.canary_tamano !== null && d.canary_revisado_at !== null
          ? {
              tamano: d.canary_tamano,
              salioAt: d.canary_revisado_at.toISOString(),
              continuadaAt: d.canary_continuada_at?.toISOString() ?? null,
              conteo: conteoMuestra,
            }
          : null,
      altasDinamicas,
    };
  }

  private async respuestasVista(envios: readonly DifusionEnvio[]): Promise<RespuestaVista[]> {
    const wamids = envios.flatMap((e) =>
      e.respuesta_meta_message_id === null ? [] : [e.respuesta_meta_message_id],
    );
    const leadIds = [...new Set(envios.flatMap((e) => (e.lead_id === null ? [] : [e.lead_id])))];
    const lectura =
      this.deps.leerRespuestas && envios.length > 0
        ? await this.deps.leerRespuestas(wamids, leadIds)
        : null;
    return envios.flatMap((e) => {
      if (e.respondido_at === null) return [];
      const texto =
        e.respuesta_meta_message_id === null
          ? undefined
          : lectura?.textos.get(e.respuesta_meta_message_id);
      return [
        {
          leadId: e.lead_id,
          nombre: e.lead_id === null ? null : (lectura?.nombres.get(e.lead_id) ?? null),
          texto: texto?.contenido ?? null,
          tipo: texto?.tipo ?? null,
          respondidoAt: e.respondido_at.toISOString(),
        },
      ];
    });
  }

  async estadoCupo(): Promise<CupoVista> {
    const ahora = this.ahora();
    const [tope, usado24h] = await Promise.all([
      this.deps.leerTopeMensajeria(),
      this.deps.audiencia.usoCupoDesde(new Date(ahora.getTime() - DIA_MS)),
    ]);
    if (tope.estado !== "ok") return { estado: "sin-dato", motivo: tope.motivo, solicitado: 0 };
    const cupo = cupoParaPlanificar({ tope: tope.tope, usado24h });
    return {
      estado: "ok",
      tope: tope.tope,
      usado24h,
      reserva: cupo.reserva,
      restante: cupo.restante,
      porTanda: Math.max(0, cupo.restante - cupo.reserva),
      solicitado: 0,
      alcanza: true,
    };
  }

  async catalogosAudiencia(): Promise<CatalogosAudienciaVista> {
    const [tags, usuarios, difusiones] = await Promise.all([
      this.deps.tags.list(),
      this.deps.usuarios.list(),
      this.deps.difusiones.list({ limite: LIMITE_CAMPANIAS }),
    ]);
    const porEtiqueta = (a: OpcionCatalogo, b: OpcionCatalogo) =>
      a.etiqueta.localeCompare(b.etiqueta, "es");
    return {
      etiquetas: tags
        .map((t) => ({ valor: t.id, etiqueta: t.nombre, color: t.color }))
        .sort(porEtiqueta),
      vendedores: usuarios
        .filter((u) => u.activo)
        .map((u) => ({ valor: u.id, etiqueta: u.nombre }))
        .sort(porEtiqueta),
      campanias: difusiones
        .filter((d) => d.estado !== "borrador")
        .map((d) => ({ valor: d.id, etiqueta: d.nombre })),
    };
  }

  async valoresDeVariables(leadIds: readonly UUID[]): Promise<Record<UUID, ValoresDeLead>> {
    const datosDelLead = this.deps.datosDelLead;
    if (!datosDelLead) return {};
    const ids = [...new Set(leadIds)];
    if (ids.length > MAX_VALORES_MUESTRA) {
      throw new ValidationError(`se piden hasta ${MAX_VALORES_MUESTRA} leads por vez`);
    }
    const todos = new Set<CampoParametro>(CAMPOS_PARAMETRO);
    const pares = await Promise.all(
      ids.map(async (id) => [id, valoresDe(await datosDelLead(id, todos))] as const),
    );
    return Object.fromEntries(pares);
  }

  // -----------------------------------------------------------------------

  /**
   * Una fila de `admin_actions` por exclusión eximible que cambió: eximirla
   * (dejar que esos leads reciban) o restituirla. `true` = eximida.
   */
  private async auditarExenciones(
    difusionId: UUID,
    actorId: UUID,
    antes: Record<"en_negociacion" | "cap_frecuencia", boolean>,
    despues: Record<"en_negociacion" | "cap_frecuencia", boolean>,
  ): Promise<void> {
    for (const motivo of ["en_negociacion", "cap_frecuencia"] as const) {
      if (antes[motivo] === despues[motivo]) continue;
      await this.deps.audit.create({
        actor_user_id: actorId,
        action: despues[motivo] ? ACCION_EXCLUSION_EXIMIDA : ACCION_EXCLUSION_RESTITUIDA,
        entity_type: "difusion",
        entity_id: difusionId,
        payload: { motivo },
      });
    }
  }

  private async exigir(id: UUID): Promise<Difusion> {
    const d = await this.deps.difusiones.findById(id);
    if (!d) throw new NotFoundError(`difusión no encontrada: ${id}`, "difusion", id);
    return d;
  }

  /** Todo lo que el planificador necesita saber, leído una sola vez. */
  private async contexto(compilada: AudienciaCompilada, ahora: Date): Promise<ContextoPlan> {
    const candidatos = await this.deps.audiencia.resolver(compilada, ahora);
    return leerContextoPlan(this.deps, candidatos, ahora);
  }

  private entrada(
    ctx: ContextoPlan,
    opciones: OpcionesPlan,
    ahora: Date,
  ): Omit<EntradaPlanificador, "cupo"> {
    return {
      ahora,
      audiencia: ctx.candidatos.map(aCandidato),
      supresiones: ctx.supresiones,
      saturaciones: ctx.saturaciones,
      maxSalientesAutomaticos24h: ctx.maxSalientes,
      plantilla: opciones.plantilla,
      textoLibre: opciones.textoLibre,
      incluirEnNegociacion: opciones.incluirEnNegociacion,
      exentaTopeFrecuencia: opciones.exentaTopeFrecuencia,
    };
  }

  /**
   * El plan para mostrar. A quién excluye y por qué ruta sale cada uno no
   * depende del cupo —sólo las tandas—, así que sin cupo o sin dato de Meta se
   * planifica con un cupo sin techo para poder mostrar la audiencia, y el
   * cupo dice que no alcanza o que no se sabe. Lo que no se muestra en ese
   * caso son las tandas: serían un reparto inventado.
   */
  private planificar(
    ctx: ContextoPlan,
    opciones: OpcionesPlan,
    ahora: Date,
  ): { plan: PlanDifusion; cupo: CupoVista } {
    const base = this.entrada(ctx, opciones, ahora);
    const sinTecho = () =>
      planificarDifusion({ ...base, cupo: { restante: SIN_TECHO, reserva: 0 } });

    const tope = ctx.tope;
    if (tope.estado !== "ok") {
      const plan = sinTecho();
      return {
        plan,
        cupo: { estado: "sin-dato", motivo: tope.motivo, solicitado: plan.cupo.solicitado },
      };
    }

    const disponible = cupoParaPlanificar({ tope: tope.tope, usado24h: ctx.usado24h });
    const vista = (plan: PlanDifusion, alcanza: boolean): CupoVista => ({
      estado: "ok",
      tope: tope.tope,
      usado24h: ctx.usado24h,
      reserva: disponible.reserva,
      restante: disponible.restante,
      porTanda: alcanza ? plan.cupo.porTanda : 0,
      solicitado: plan.cupo.solicitado,
      alcanza,
    });

    try {
      const plan = planificarDifusion({ ...base, cupo: disponible });
      return { plan, cupo: vista(plan, true) };
    } catch (e) {
      if (!(e instanceof BudgetExceededError)) throw e;
      const plan = sinTecho();
      return { plan, cupo: vista(plan, false) };
    }
  }

  private async yaProgramada(d: Difusion): Promise<ResultadoProgramar> {
    const [conteo, tandas] = await Promise.all([
      this.deps.envios.contarPorDifusion(d.id),
      this.deps.envios.tandasPorDifusion(d.id),
    ]);
    const destinatarios = conteo.total - conteo.porEstado.excluido;
    // Sólo mientras no arrancó: el motor deduplica por id, y lo que ya se está
    // enviando no necesita otro aviso.
    if (d.estado === "programada" && d.programada_para !== null && conteo.total > 0) {
      await this.avisar({
        difusionId: d.id,
        programadaPara: d.programada_para,
        audienciaInicial: conteo.total,
        destinatarios,
      });
    }
    return {
      difusionId: d.id,
      audienciaInicial: conteo.total,
      destinatarios,
      tandas: tandas.length,
      yaEstabaProgramada: true,
    };
  }

  private async avisar(datos: Parameters<typeof eventoDifusionProgramada>[0]): Promise<void> {
    const evento = eventoDifusionProgramada(datos);
    try {
      await this.deps.avisarProgramada(evento);
    } catch (e) {
      // No se relanza: la fila de `event_outbox` quedó en la misma transacción
      // que el plan y el cron `dispatch-outbox-events` la reenvía.
      this.deps.logger.warn("difusion.aviso_directo_fallido", {
        difusionId: datos.difusionId,
        tipo: e instanceof Error ? e.name : typeof e,
        detalle: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async diffContraAnterior(
    plan: PlanDifusion,
    excluir: UUID | null,
  ): Promise<{ vista: DiffVista; porLead: Map<UUID, "nuevo" | "repite"> } | null> {
    const recientes = await this.deps.difusiones.list({ limite: RECIENTES_PARA_DIFF });
    const anterior = recientes.find((d) => d.estado !== "borrador" && d.id !== excluir);
    if (!anterior) return null;

    // Hasta una página vacía, no hasta una corta: el corte del servidor puede
    // ser menor que el límite pedido.
    const previos = new Set<UUID>();
    for (let desde = 0; ; ) {
      const filas = await this.deps.envios.listarPorDifusion(anterior.id, {
        limite: LIMITE_MAX_PAGINA,
        desde,
      });
      if (filas.length === 0) break;
      for (const f of filas) {
        if (f.estado !== "excluido" && f.lead_id !== null) previos.add(f.lead_id);
      }
      desde += filas.length;
    }

    const porLead = new Map<UUID, "nuevo" | "repite">();
    let nuevos = 0;
    let repiten = 0;
    for (const d of plan.destinatarios) {
      if (previos.has(d.leadId)) {
        repiten += 1;
        porLead.set(d.leadId, "repite");
      } else {
        nuevos += 1;
        porLead.set(d.leadId, "nuevo");
      }
    }
    let yaNoCalifican = 0;
    for (const id of previos) if (!porLead.has(id)) yaNoCalifican += 1;

    return {
      vista: {
        referencia: { id: anterior.id, nombre: anterior.nombre },
        nuevos,
        repiten,
        yaNoCalifican,
      },
      porLead,
    };
  }
}

function valoresDe(datos: DatosInterpolacion): ValoresDeLead {
  const valores: ValoresDeLead = {};
  const poner = (campo: CampoParametro, v: unknown) => {
    if (typeof v === "string" && v.trim() !== "") valores[campo] = v;
  };
  poner("nombre", datos.lead?.nombre);
  poner("nombre_perfil", datos.lead?.nombre_perfil);
  poner("vehiculo_marca", datos.lead?.vehiculo_marca);
  poner("vehiculo_modelo", datos.lead?.vehiculo_modelo);
  poner("vehiculo_anio", datos.lead?.vehiculo_anio);
  poner("consulta", datos.sesion?.consulta);
  return valores;
}

function vistaTanda(t: TandaPlanificada): TandaVista {
  return {
    tanda: t.tanda,
    desde: t.desde.toISOString(),
    porPlantilla: t.porPlantilla,
    porVentanaAbierta: t.porVentanaAbierta,
  };
}

function iso(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

export function vistaDifusion(d: Difusion): DifusionVista {
  return {
    id: d.id,
    nombre: d.nombre,
    estado: d.estado,
    audiencia: d.audiencia,
    audienciaTodaLaBase: d.audiencia_toda_la_base,
    audienciaModo: d.audiencia_modo,
    plantillaNombre: d.plantilla_nombre,
    plantillaCategoria: d.plantilla_categoria,
    plantillaIdioma: d.plantilla_idioma,
    plantillaParametros: d.plantilla_parametros,
    textoLibre: d.texto_libre,
    incluirEnNegociacion: d.incluir_en_negociacion,
    exentaTopeFrecuencia: d.exenta_tope_frecuencia,
    canaryTamano: d.canary_tamano,
    programadaPara: iso(d.programada_para),
    iniciadaAt: iso(d.iniciada_at),
    finalizadaAt: iso(d.finalizada_at),
    motivoDetencion: d.motivo_detencion,
    motivoRevision: d.motivo_revision,
    detenidaPorPersona: d.detenida_por !== null,
    creadaAt: d.created_at.toISOString(),
  };
}

function validarTextoLibre(texto: string): string {
  const r = TextoLibreSchema.safeParse(texto);
  if (!r.success) {
    throw new ValidationError(r.error.issues[0]?.message ?? "el texto libre no es válido");
  }
  return r.data;
}
