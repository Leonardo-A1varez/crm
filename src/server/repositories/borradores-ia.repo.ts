import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  CODIGO_ERROR_BORRADOR,
  ESTADOS_VIGENTES,
  ORIGENES_BORRADOR,
  VIAS_USO_BORRADOR,
  type BorradorIa,
  type EstadoBorrador,
  type OrigenBorrador,
  type ViaUsoBorrador,
} from "@/types/copiloto";
import type { UUID } from "@/types/entities";

/** Qué pasó al arrancar un borrador (espeja el RPC `iniciar_borrador_ia`). */
export type ResultadoIniciar =
  /** Descartó los vigentes de la conversación y creó uno `redactando`. */
  | { resultado: "creado"; borradorId: UUID }
  /** Ya había uno para ese entrante (idempotencia por `mensaje_origen_id`). */
  | { resultado: "existente"; borradorId: UUID; estado: EstadoBorrador }
  /** El entrante ya no es el último de la conversación: el más viejo no pisa al nuevo. */
  | { resultado: "obsoleto" };

export interface IniciarBorradorInput {
  conversacionId: UUID;
  leadSessionId: UUID;
  mensajeOrigenId: UUID;
  /** Regenerar / Reintentar: ignora el borrador que ya existe para ese entrante. */
  forzar?: boolean;
}

export interface CompletarBorradorInput {
  contenido: string;
  origen: OrigenBorrador;
  reglaId: UUID | null;
}

export interface MarcarUsadoInput {
  via: ViaUsoBorrador;
  usuarioId: UUID | null;
}

export type ResultadoMarcarUsado =
  /** Esta llamada lo pasó de `listo` a `usado`. */
  | "marcado"
  /** Ya estaba usado (otra llamada llegó antes): no repetir lo que sigue al uso. */
  | "ya_usado"
  /** No existe o no está `listo` (redactando, error, descartado). */
  | "no_disponible";

/**
 * Los borradores del copiloto (`borradores_ia`).
 *
 * Los escribe el pipeline y la función de Regenerar con service-role (`iniciar`,
 * `completar`, `marcarError`, `descartar*`); el panel, con el cliente
 * autenticado, solo lee y usa `marcarUsado` (la policy de update de la tabla
 * solo deja pasar `listo` → `usado`). El texto (`contenido`) lo escribe solo el
 * pipeline: la edición del vendedor es local en la UI y nunca vuelve a la tabla.
 *
 * Invariante: a lo sumo UN borrador vigente (`redactando | listo | error`) por
 * conversación. `completar` y `marcarError` son condicionales al estado
 * `redactando`: un turno viejo que termina tarde no puede resucitar un borrador
 * que otro ya reemplazó.
 *
 * Errores (igual en las dos implementaciones): una conversación inexistente en
 * `iniciar` es `NotFoundError`; una FK rota (sesión, regla, usuario) es
 * `ConflictError`; un `codigo` de error que no es un código corto es
 * `ValidationError`.
 */
export interface BorradoresIaRepository {
  iniciar(input: IniciarBorradorInput): Promise<ResultadoIniciar>;
  /** `null` si ya no estaba `redactando` (fue reemplazado o descartado). */
  completar(id: UUID, input: CompletarBorradorInput): Promise<BorradorIa | null>;
  /** `null` si ya no estaba `redactando`. `codigo` es un código corto, no texto libre. */
  marcarError(id: UUID, codigo: string): Promise<BorradorIa | null>;
  /** Pasa un vigente a `descartado`. `false` si ya no era vigente. */
  descartar(id: UUID): Promise<boolean>;
  /** Descarta los vigentes de la conversación. Devuelve cuántos. No toca `usado`. */
  descartarVigentes(conversacionId: UUID): Promise<number>;
  marcarUsado(id: UUID, input: MarcarUsadoInput): Promise<ResultadoMarcarUsado>;
  findById(id: UUID): Promise<BorradorIa | null>;
  /** El más reciente que no está descartado (vigente o usado). */
  findActualByConversacion(conversacionId: UUID): Promise<BorradorIa | null>;
  /** De estas conversaciones, las que tienen un borrador `listo`. */
  listListosPorConversacionIds(conversacionIds: readonly UUID[]): Promise<UUID[]>;
}

/** Quién es el último entrante de una conversación (lo resuelve el RPC en la base). */
export type ResolverUltimoEntrante = (conversacionId: UUID) => Promise<UUID | null> | UUID | null;

/**
 * Qué filas "existen" fuera de este repo, para que el InMemory rechace lo que la
 * base rechaza con sus FK. Cada una es opcional: sin ella, el InMemory acepta
 * cualquier id (los tests que no prueban FK no tienen que sembrar nada).
 */
export interface ReferenciasInMemory {
  conversacionExiste?: (id: UUID) => boolean;
  leadSessionExiste?: (id: UUID) => boolean;
  reglaExiste?: (id: UUID) => boolean;
  usuarioExiste?: (id: UUID) => boolean;
}

/**
 * Los tres `validar*` espejan los CHECK de la tabla (`error_codigo`, `origen`,
 * `usado_via`). Los tipos ya los garantizan en compilación; esto cubre al caller
 * sin tipos. Los llaman las dos implementaciones ANTES de tocar nada, así el
 * error no depende de cuál esté detrás ni de si el UPDATE alcanzaría la fila.
 */
export function validarCodigoError(codigo: string): void {
  if (!CODIGO_ERROR_BORRADOR.test(codigo)) {
    throw new ValidationError("error_codigo debe ser un código corto (a-z y _, 1 a 40)", {
      campo: "error_codigo",
    });
  }
}

export function validarOrigen(origen: string): void {
  if (!(ORIGENES_BORRADOR as readonly string[]).includes(origen)) {
    throw new ValidationError(`origen fuera de dominio: ${origen}`, { campo: "origen" });
  }
}

export function validarVia(via: string): void {
  if (!(VIAS_USO_BORRADOR as readonly string[]).includes(via)) {
    throw new ValidationError(`via fuera de dominio: ${via}`, { campo: "usado_via" });
  }
}

function esVigente(estado: EstadoBorrador): boolean {
  return (ESTADOS_VIGENTES as readonly string[]).includes(estado);
}

function copia(b: BorradorIa): BorradorIa {
  return {
    ...b,
    created_at: new Date(b.created_at),
    updated_at: new Date(b.updated_at),
    usado_at: b.usado_at === null ? null : new Date(b.usado_at),
  };
}

function fkRota(columna: string): ConflictError {
  return new ConflictError(`${columna} no existe`, "foreign_key_violation");
}

export class InMemoryBorradoresIaRepository implements BorradoresIaRepository {
  private readonly store = new Map<UUID, BorradorIa>();
  /** Orden de inserción: desempata `created_at` dentro de la misma milésima. */
  private readonly orden = new Map<UUID, number>();
  private contador = 0;

  /**
   * `ultimoEntrante` es opcional: sin él, cualquier entrante cuenta como el
   * último (no se prueba `obsoleto`). Los tests que sí lo necesitan inyectan la
   * consulta a su repo de mensajes, como hace el RPC con la tabla `mensajes`.
   */
  constructor(
    private readonly ultimoEntrante: ResolverUltimoEntrante | null = null,
    private readonly referencias: ReferenciasInMemory = {},
  ) {}

  private masNuevoPrimero = (a: BorradorIa, b: BorradorIa): number =>
    (this.orden.get(b.id) ?? 0) - (this.orden.get(a.id) ?? 0);

  async iniciar(input: IniciarBorradorInput): Promise<ResultadoIniciar> {
    // Mismo orden que el RPC: primero la conversación (P0002), después el último
    // entrante, después el borrador existente y recién al insertar, las FK.
    if (this.referencias.conversacionExiste?.(input.conversacionId) === false) {
      throw new NotFoundError(
        `conversación no encontrada: ${input.conversacionId}`,
        "conversacion",
        input.conversacionId,
      );
    }
    if (this.ultimoEntrante !== null) {
      const ultimo = await this.ultimoEntrante(input.conversacionId);
      if (ultimo !== input.mensajeOrigenId) return { resultado: "obsoleto" };
    }

    const previo = [...this.store.values()]
      .filter((b) => b.mensaje_origen_id === input.mensajeOrigenId && b.estado !== "descartado")
      .sort(this.masNuevoPrimero)[0];
    if (previo && input.forzar !== true) {
      return { resultado: "existente", borradorId: previo.id, estado: previo.estado };
    }

    if (this.referencias.leadSessionExiste?.(input.leadSessionId) === false) {
      throw fkRota("lead_session_id");
    }

    const ahora = new Date();
    for (const b of this.store.values()) {
      if (b.conversacion_id === input.conversacionId && esVigente(b.estado)) {
        b.estado = "descartado";
        b.updated_at = ahora;
      }
    }

    const fila: BorradorIa = {
      id: crypto.randomUUID(),
      conversacion_id: input.conversacionId,
      lead_session_id: input.leadSessionId,
      mensaje_origen_id: input.mensajeOrigenId,
      estado: "redactando",
      contenido: null,
      origen: null,
      regla_id: null,
      error_codigo: null,
      usado_at: null,
      usado_via: null,
      usado_por: null,
      created_at: ahora,
      updated_at: ahora,
    };
    this.store.set(fila.id, fila);
    this.orden.set(fila.id, ++this.contador);
    return { resultado: "creado", borradorId: fila.id };
  }

  async completar(id: UUID, input: CompletarBorradorInput): Promise<BorradorIa | null> {
    validarOrigen(input.origen);
    const b = this.store.get(id);
    if (!b || b.estado !== "redactando") return null;
    // La FK solo se evalúa si el UPDATE alcanza la fila, como en Postgres.
    if (input.reglaId !== null && this.referencias.reglaExiste?.(input.reglaId) === false) {
      throw fkRota("regla_id");
    }
    b.estado = "listo";
    b.contenido = input.contenido;
    b.origen = input.origen;
    b.regla_id = input.reglaId;
    b.updated_at = new Date();
    return copia(b);
  }

  async marcarError(id: UUID, codigo: string): Promise<BorradorIa | null> {
    validarCodigoError(codigo);
    const b = this.store.get(id);
    if (!b || b.estado !== "redactando") return null;
    b.estado = "error";
    b.error_codigo = codigo;
    b.updated_at = new Date();
    return copia(b);
  }

  async descartar(id: UUID): Promise<boolean> {
    const b = this.store.get(id);
    if (!b || !esVigente(b.estado)) return false;
    b.estado = "descartado";
    b.updated_at = new Date();
    return true;
  }

  async descartarVigentes(conversacionId: UUID): Promise<number> {
    let n = 0;
    for (const b of this.store.values()) {
      if (b.conversacion_id === conversacionId && esVigente(b.estado)) {
        b.estado = "descartado";
        b.updated_at = new Date();
        n += 1;
      }
    }
    return n;
  }

  async marcarUsado(id: UUID, input: MarcarUsadoInput): Promise<ResultadoMarcarUsado> {
    validarVia(input.via);
    const b = this.store.get(id);
    if (!b) return "no_disponible";
    if (b.estado === "usado") return "ya_usado";
    if (b.estado !== "listo") return "no_disponible";
    if (input.usuarioId !== null && this.referencias.usuarioExiste?.(input.usuarioId) === false) {
      throw fkRota("usado_por");
    }
    const ahora = new Date();
    b.estado = "usado";
    b.usado_via = input.via;
    b.usado_por = input.usuarioId;
    b.usado_at = ahora;
    b.updated_at = ahora;
    return "marcado";
  }

  async findById(id: UUID): Promise<BorradorIa | null> {
    const b = this.store.get(id);
    return b ? copia(b) : null;
  }

  async findActualByConversacion(conversacionId: UUID): Promise<BorradorIa | null> {
    const b = [...this.store.values()]
      .filter((x) => x.conversacion_id === conversacionId && x.estado !== "descartado")
      .sort(this.masNuevoPrimero)[0];
    return b ? copia(b) : null;
  }

  async listListosPorConversacionIds(conversacionIds: readonly UUID[]): Promise<UUID[]> {
    const buscadas = new Set(conversacionIds);
    const salida = new Set<UUID>();
    for (const b of this.store.values()) {
      if (b.estado === "listo" && buscadas.has(b.conversacion_id)) salida.add(b.conversacion_id);
    }
    return [...salida];
  }
}
