import { ConflictError, NotFoundError } from "@/lib/errors";
import type { UUID } from "@/types/entities";

/**
 * Las plantillas que un flujo le manda a un lead sin sesión
 * (`supabase/migrations/20260925210000_workflow_plantillas_sin_sesion.sql`).
 *
 * Viven acá y no en `mensajes` porque `mensajes` exige una sesión. Cuando el
 * lead responde se anotan en el hilo y `mensaje_id` apunta a esa fila.
 */

export type EstadoPlantillaSinSesion = "reservado" | "aceptado" | "entregado" | "leido" | "fallido";

export interface PlantillaSinSesion {
  id: UUID;
  idempotency_key: string;
  workflow_run_id: UUID | null;
  lead_id: UUID;
  conversacion_id: UUID;
  plantilla_nombre: string;
  plantilla_idioma: string;
  contenido: string;
  parametros_cuerpo: string[];
  intento_at: Date;
  meta_message_id: string | null;
  estado: EstadoPlantillaSinSesion;
  estado_at: Date | null;
  error_codigo: string | null;
  error_detalle: string | null;
  mensaje_id: UUID | null;
}

export interface ReservaPlantillaSinSesion {
  idempotency_key: string;
  workflow_run_id: UUID | null;
  lead_id: UUID;
  conversacion_id: UUID;
  plantilla_nombre: string;
  plantilla_idioma: string;
  contenido: string;
  parametros_cuerpo: string[];
  intento_at: Date;
}

/** Los estados que llegan por webhook. `enviado` es el 200 que ya se anotó. */
export type EstadoMetaPlantilla = "entregado" | "leido" | "fallido";

export interface WorkflowPlantillasSinSesionRepository {
  findByIdempotencyKey(clave: string): Promise<PlantillaSinSesion | null>;
  /** Escribe la reserva. `ConflictError` si la clave ya existe. */
  reservar(input: ReservaPlantillaSinSesion): Promise<PlantillaSinSesion>;
  marcarAceptado(id: UUID, wamid: string): Promise<PlantillaSinSesion>;
  marcarFallido(id: UUID, error: { codigo: string; detalle: string | null }): Promise<void>;
  /** Meta rechazó explícitamente (429): no salió nada y el reintento puede volver a probar. */
  liberarReserva(id: UUID): Promise<void>;
  /**
   * Estado de entrega por wamid. `false` si el wamid no es de esta tabla. No
   * retrocede: un `entregado` tardío no pisa un `leido`.
   */
  aplicarEstadoMeta(
    wamid: string,
    estado: EstadoMetaPlantilla,
    at: Date,
    error?: { codigo: string | null; detalle: string | null },
  ): Promise<boolean>;
  /** Cuántas salieron (o se intentaron) desde `desde` y todavía no están en el hilo. */
  contarNoAnotadasDesde(leadId: UUID, desde: Date): Promise<number>;
  /** Las que salieron desde `desde`, con wamid y sin anotar, lo más viejo primero. */
  pendientesDeAnotar(leadId: UUID, desde: Date, limite: number): Promise<PlantillaSinSesion[]>;
  marcarAnotada(id: UUID, mensajeId: UUID): Promise<void>;
}

/** Orden de avance de los estados de entrega: nunca se retrocede. */
const RANGO: Record<EstadoPlantillaSinSesion, number> = {
  reservado: 0,
  aceptado: 1,
  entregado: 2,
  leido: 3,
  fallido: 4,
};

/** Si un estado de Meta mueve la fila. Compartido por las dos impl. */
export function avanzaEstado(
  actual: EstadoPlantillaSinSesion,
  nuevo: EstadoMetaPlantilla,
): boolean {
  if (actual === "fallido") return false;
  if (nuevo === "fallido") return true;
  return RANGO[nuevo] > RANGO[actual];
}

/**
 * Los estados desde los que `nuevo` avanza: `avanzaEstado` dado vuelta para el
 * WHERE del UPDATE. Un CAS contra el estado leído perdía el avance cuando dos
 * webhooks leían lo mismo y el menor escribía primero ("leído" quedaba afuera).
 */
export function estadosQueAvanzanAPlantilla(
  nuevo: EstadoMetaPlantilla,
): EstadoPlantillaSinSesion[] {
  return (Object.keys(RANGO) as EstadoPlantillaSinSesion[]).filter((a) => avanzaEstado(a, nuevo));
}

/** Los estados que cuentan como "salió o pudo salir" para el tope. */
export const CUENTAN_PARA_TOPE: readonly EstadoPlantillaSinSesion[] = [
  "reservado",
  "aceptado",
  "entregado",
  "leido",
];

export class InMemoryWorkflowPlantillasSinSesionRepository implements WorkflowPlantillasSinSesionRepository {
  private readonly filas = new Map<UUID, PlantillaSinSesion>();
  private secuencia = 0;

  async findByIdempotencyKey(clave: string): Promise<PlantillaSinSesion | null> {
    const fila = [...this.filas.values()].find((f) => f.idempotency_key === clave);
    return fila ? { ...fila } : null;
  }

  async reservar(input: ReservaPlantillaSinSesion): Promise<PlantillaSinSesion> {
    if (await this.findByIdempotencyKey(input.idempotency_key)) {
      throw new ConflictError(
        `ya hay una plantilla reservada con la clave ${input.idempotency_key}`,
        "idempotency_key_duplicada",
      );
    }
    this.secuencia += 1;
    const fila: PlantillaSinSesion = {
      ...input,
      parametros_cuerpo: [...input.parametros_cuerpo],
      id: `00000000-0000-4000-8000-${String(this.secuencia).padStart(12, "0")}`,
      meta_message_id: null,
      estado: "reservado",
      estado_at: null,
      error_codigo: null,
      error_detalle: null,
      mensaje_id: null,
    };
    this.filas.set(fila.id, fila);
    return { ...fila };
  }

  private exigir(id: UUID): PlantillaSinSesion {
    const fila = this.filas.get(id);
    if (!fila)
      throw new NotFoundError(`plantilla sin sesión no encontrada: ${id}`, "plantilla", id);
    return fila;
  }

  async marcarAceptado(id: UUID, wamid: string): Promise<PlantillaSinSesion> {
    const fila = this.exigir(id);
    const otra = [...this.filas.values()].find((f) => f.meta_message_id === wamid && f.id !== id);
    if (otra) throw new ConflictError(`wamid repetido: ${wamid}`, "wamid_duplicado");
    fila.meta_message_id = wamid;
    if (fila.estado === "reservado") fila.estado = "aceptado";
    return { ...fila };
  }

  async marcarFallido(id: UUID, error: { codigo: string; detalle: string | null }): Promise<void> {
    const fila = this.exigir(id);
    fila.estado = "fallido";
    fila.error_codigo = error.codigo;
    fila.error_detalle = error.detalle;
  }

  async liberarReserva(id: UUID): Promise<void> {
    const fila = this.filas.get(id);
    if (fila && fila.estado === "reservado" && fila.meta_message_id === null) {
      this.filas.delete(id);
    }
  }

  async aplicarEstadoMeta(
    wamid: string,
    estado: EstadoMetaPlantilla,
    at: Date,
    error?: { codigo: string | null; detalle: string | null },
  ): Promise<boolean> {
    const fila = [...this.filas.values()].find((f) => f.meta_message_id === wamid);
    if (!fila) return false;
    if (avanzaEstado(fila.estado, estado)) {
      fila.estado = estado;
      fila.estado_at = at;
      if (estado === "fallido") {
        fila.error_codigo = error?.codigo ?? null;
        fila.error_detalle = error?.detalle ?? null;
      }
    }
    return true;
  }

  async contarNoAnotadasDesde(leadId: UUID, desde: Date): Promise<number> {
    return [...this.filas.values()].filter(
      (f) =>
        f.lead_id === leadId &&
        f.mensaje_id === null &&
        f.intento_at >= desde &&
        CUENTAN_PARA_TOPE.includes(f.estado),
    ).length;
  }

  async pendientesDeAnotar(
    leadId: UUID,
    desde: Date,
    limite: number,
  ): Promise<PlantillaSinSesion[]> {
    return [...this.filas.values()]
      .filter(
        (f) =>
          f.lead_id === leadId &&
          f.mensaje_id === null &&
          f.meta_message_id !== null &&
          f.estado !== "fallido" &&
          f.intento_at >= desde,
      )
      .sort((a, b) => b.intento_at.getTime() - a.intento_at.getTime())
      .slice(0, limite)
      .reverse()
      .map((f) => ({ ...f }));
  }

  async marcarAnotada(id: UUID, mensajeId: UUID): Promise<void> {
    this.exigir(id).mensaje_id = mensajeId;
  }
}
