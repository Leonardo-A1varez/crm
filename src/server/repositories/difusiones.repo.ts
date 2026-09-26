import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  LARGO_MAXIMO_TEXTO_LIBRE,
  type CategoriaPlantilla,
  type Difusion,
  type EstadoDifusion,
  type ModoAudiencia,
} from "@/lib/difusion/modelo";
import {
  IdiomaPlantillaSchema,
  ParametrosPlantillaSchema,
  type ParametroPlantilla,
} from "@/lib/difusion/parametros";
import type { Grupo } from "@/lib/ui/condiciones";
import { validarAudiencia } from "@/lib/validation/difusion.schema";
import type { UUID } from "@/types/entities";
import { exigirPagina } from "./_paginacion";

/**
 * Una difusión nace siempre borrador: el estado no se elige al crear. Lo que no
 * se pasa toma el default seguro de la base (congelada, sin exenciones, sin
 * canary).
 */
export interface DifusionInsert {
  nombre: string;
  audiencia: Grupo;
  creada_por: UUID | null;
  /** Elegir toda la base exige el árbol vacío. Default: false. */
  audiencia_toda_la_base?: boolean;
  audiencia_modo?: ModoAudiencia;
  plantilla_nombre?: string | null;
  plantilla_categoria?: CategoriaPlantilla | null;
  plantilla_idioma?: string | null;
  plantilla_parametros?: ParametroPlantilla[];
  texto_libre?: string | null;
  incluir_en_negociacion?: boolean;
  exenta_tope_frecuencia?: boolean;
  canary_tamano?: number | null;
}

export type DifusionUpdate = Partial<
  Pick<
    Difusion,
    | "nombre"
    | "estado"
    | "audiencia"
    | "audiencia_toda_la_base"
    | "audiencia_modo"
    | "plantilla_nombre"
    | "plantilla_categoria"
    | "plantilla_idioma"
    | "plantilla_parametros"
    | "texto_libre"
    | "audiencia_tanda_evaluada"
    | "incluir_en_negociacion"
    | "exenta_tope_frecuencia"
    | "canary_tamano"
    | "canary_revisado_at"
    | "canary_continuada_at"
    | "programada_para"
    | "iniciada_at"
    | "finalizada_at"
    | "detenida_por"
    | "motivo_detencion"
    | "motivo_revision"
  >
>;

/** Estados en los que el motor tiene algo que drenar. */
export const ESTADOS_CON_COLA: readonly EstadoDifusion[] = ["programada", "enviando"];

export interface DifusionesRepository {
  /** Valida la audiencia con `AudienciaSchema` antes de escribir. */
  create(input: DifusionInsert): Promise<Difusion>;
  findById(id: UUID): Promise<Difusion | null>;
  /** Las más recientes primero. */
  list(pagina: { limite: number }): Promise<Difusion[]>;
  /** `ValidationError` si el resultado rompe una regla de la tabla (programada sin fecha, detenida sin motivo…). */
  update(id: UUID, patch: DifusionUpdate): Promise<Difusion>;
  /**
   * El cambio sólo si la difusión sigue en uno de `desde`. `null` si ya no
   * está (una persona la pausó o detuvo en el medio): el motor no pisa esa
   * decisión. `NotFoundError` si no existe.
   */
  actualizarSiEstado(
    id: UUID,
    desde: readonly EstadoDifusion[],
    patch: DifusionUpdate,
  ): Promise<Difusion | null>;
  /** Programadas y enviándose, la programada antes primero: lo que el motor drena. */
  listarConCola(): Promise<Difusion[]>;
  /**
   * Sólo borradores. Una que salió o está programada es el registro de a quién
   * se le mandó qué: se detiene, no se borra (`ValidationError`). Idempotente
   * con un id que no existe.
   */
  delete(id: UUID): Promise<void>;
}

type DifusionSinIdentidad = Omit<Difusion, "id" | "created_at" | "updated_at">;

/**
 * Los CHECK de `difusiones`, en TypeScript: el in-memory falla donde falla la
 * base. `null` si la fila es coherente.
 */
export function incoherenciaDifusion(d: DifusionSinIdentidad): string | null {
  const nombre = d.nombre.trim().length;
  if (nombre < 1 || nombre > 120) return "el nombre tiene que tener entre 1 y 120 caracteres";
  if (d.audiencia_toda_la_base && d.audiencia.hijos.length > 0) {
    return "toda la base va con la audiencia sin condiciones: son dos elecciones que se contradicen";
  }
  if (d.estado !== "borrador" && !d.audiencia_toda_la_base && d.audiencia.hijos.length === 0) {
    return "una difusión que sale necesita condiciones, o haber elegido toda la base a propósito";
  }
  if ((d.plantilla_nombre === null) !== (d.plantilla_categoria === null)) {
    return "la plantilla va con su categoría, o ninguna de las dos";
  }
  if (
    d.plantilla_nombre !== null &&
    (d.plantilla_nombre.length < 1 || d.plantilla_nombre.length > 512)
  ) {
    return "el nombre de la plantilla tiene que tener entre 1 y 512 caracteres";
  }
  if (
    d.canary_tamano !== null &&
    (!Number.isInteger(d.canary_tamano) || d.canary_tamano < 1 || d.canary_tamano > 10_000)
  ) {
    return "el canary tiene que ser un entero entre 1 y 10.000";
  }
  if (d.plantilla_idioma !== null && !IdiomaPlantillaSchema.safeParse(d.plantilla_idioma).success) {
    return "el idioma de la plantilla no tiene la forma de Meta";
  }
  if (d.plantilla_idioma !== null && d.plantilla_nombre === null) {
    return "el idioma va con una plantilla elegida";
  }
  if (d.estado !== "borrador" && (d.plantilla_nombre === null || d.plantilla_idioma === null)) {
    return "una difusión que sale necesita la plantilla y su idioma";
  }
  if (d.texto_libre !== null) {
    const largo = d.texto_libre.trim().length;
    if (largo < 1 || largo > LARGO_MAXIMO_TEXTO_LIBRE) {
      return `el texto libre va de 1 a ${LARGO_MAXIMO_TEXTO_LIBRE} caracteres`;
    }
  }
  if (d.audiencia_tanda_evaluada !== null) {
    if (!Number.isInteger(d.audiencia_tanda_evaluada) || d.audiencia_tanda_evaluada < 0) {
      return "la tanda re-evaluada es un entero ≥ 0";
    }
    if (d.audiencia_modo !== "dinamica") return "sólo una audiencia dinámica se re-evalúa";
  }
  if (!ParametrosPlantillaSchema.safeParse(d.plantilla_parametros).success) {
    return "las variables de la plantilla no tienen la forma esperada";
  }
  if (
    d.motivo_revision !== null &&
    (d.estado !== "en_revision" || d.motivo_revision.length < 1 || d.motivo_revision.length > 500)
  ) {
    return "el motivo de revisión va sólo en revisión, de 1 a 500 caracteres";
  }
  if (d.canary_revisado_at !== null && d.canary_tamano === null) {
    return "no hay muestra que revisar sin canary";
  }
  if (d.canary_continuada_at !== null && d.canary_revisado_at === null) {
    return "no se sigue después de una muestra que no se revisó";
  }
  if (d.estado === "programada" && d.programada_para === null) {
    return "una difusión programada necesita fecha";
  }
  if ((d.estado === "completada" || d.estado === "detenida") !== (d.finalizada_at !== null)) {
    return "completada y detenida llevan fecha de fin, y sólo ellas";
  }
  if ((d.estado === "detenida") !== (d.motivo_detencion !== null)) {
    return "una detención lleva motivo, y sólo una detención";
  }
  if (d.detenida_por !== null && d.estado !== "detenida") {
    return "detenida_por sólo tiene sentido en una difusión detenida";
  }
  if (
    d.motivo_detencion !== null &&
    (d.motivo_detencion.length < 1 || d.motivo_detencion.length > 500)
  ) {
    return "el motivo de detención tiene que tener entre 1 y 500 caracteres";
  }
  return null;
}

function exigirCoherencia(d: DifusionSinIdentidad): void {
  const problema = incoherenciaDifusion(d);
  if (problema) throw new ValidationError(problema);
}

/** Sólo las claves definidas: un `undefined` en el patch no borra el valor guardado. */
export function patchDefinido(patch: DifusionUpdate): DifusionUpdate {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as DifusionUpdate;
}

export class InMemoryDifusionesRepository implements DifusionesRepository {
  private readonly store = new Map<UUID, Difusion>();
  private ultimo = 0;

  /** Estrictamente creciente: dos difusiones en el mismo milisegundo no empatan. */
  private reloj(): Date {
    this.ultimo = Math.max(Date.now(), this.ultimo + 1);
    return new Date(this.ultimo);
  }

  async create(input: DifusionInsert): Promise<Difusion> {
    const audiencia = validarAudiencia(input.audiencia);
    const ahora = this.reloj();
    const d: Difusion = {
      id: crypto.randomUUID(),
      nombre: input.nombre,
      estado: "borrador",
      audiencia,
      audiencia_toda_la_base: input.audiencia_toda_la_base ?? false,
      audiencia_modo: input.audiencia_modo ?? "congelada",
      plantilla_nombre: input.plantilla_nombre ?? null,
      plantilla_categoria: input.plantilla_categoria ?? null,
      plantilla_idioma: input.plantilla_idioma ?? null,
      plantilla_parametros: input.plantilla_parametros ?? [],
      texto_libre: input.texto_libre ?? null,
      audiencia_tanda_evaluada: null,
      incluir_en_negociacion: input.incluir_en_negociacion ?? false,
      exenta_tope_frecuencia: input.exenta_tope_frecuencia ?? false,
      canary_tamano: input.canary_tamano ?? null,
      canary_revisado_at: null,
      canary_continuada_at: null,
      programada_para: null,
      iniciada_at: null,
      finalizada_at: null,
      detenida_por: null,
      motivo_detencion: null,
      motivo_revision: null,
      creada_por: input.creada_por,
      created_at: ahora,
      updated_at: ahora,
    };
    exigirCoherencia(d);
    this.store.set(d.id, d);
    return structuredClone(d);
  }

  async findById(id: UUID): Promise<Difusion | null> {
    const d = this.store.get(id);
    return d ? structuredClone(d) : null;
  }

  async list({ limite }: { limite: number }): Promise<Difusion[]> {
    exigirPagina(limite);
    return [...this.store.values()]
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, limite)
      .map((d) => structuredClone(d));
  }

  async update(id: UUID, patch: DifusionUpdate): Promise<Difusion> {
    const actual = this.store.get(id);
    if (!actual) throw new NotFoundError(`difusión no encontrada: ${id}`, "difusion", id);
    const limpio = patchDefinido(patch);
    if (limpio.audiencia !== undefined) limpio.audiencia = validarAudiencia(limpio.audiencia);

    const siguiente: Difusion = { ...actual, ...limpio, updated_at: this.reloj() };
    exigirCoherencia(siguiente);
    this.store.set(id, siguiente);
    return structuredClone(siguiente);
  }

  async actualizarSiEstado(
    id: UUID,
    desde: readonly EstadoDifusion[],
    patch: DifusionUpdate,
  ): Promise<Difusion | null> {
    const actual = this.store.get(id);
    if (!actual) throw new NotFoundError(`difusión no encontrada: ${id}`, "difusion", id);
    if (!desde.includes(actual.estado)) return null;
    return this.update(id, patch);
  }

  async listarConCola(): Promise<Difusion[]> {
    return [...this.store.values()]
      .filter((d) => ESTADOS_CON_COLA.includes(d.estado))
      .sort(
        (a, b) =>
          (a.programada_para?.getTime() ?? 0) - (b.programada_para?.getTime() ?? 0) ||
          (a.id < b.id ? -1 : 1),
      )
      .map((d) => structuredClone(d));
  }

  async delete(id: UUID): Promise<void> {
    const actual = this.store.get(id);
    if (!actual) return;
    if (actual.estado !== "borrador") {
      throw new ValidationError(`la difusión ${id} no es un borrador: se detiene, no se borra`);
    }
    this.store.delete(id);
  }
}
