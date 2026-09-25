import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { eventoDifusionProgramada, type DifusionProgramada } from "@/lib/difusion/eventos";
import type { UUID } from "@/types/entities";
import type { DifusionEnvioInsert, InMemoryDifusionEnviosRepository } from "./difusion-envios.repo";
import { incoherenciaDifusion, type InMemoryDifusionesRepository } from "./difusiones.repo";

export interface ProgramacionInput {
  difusionId: UUID;
  programadaPara: Date;
  /** Null = sin canary. */
  canaryTamano: number | null;
  /** El plan entero, de `filasDesdePlan`: destinatarios y excluidos. */
  filas: readonly DifusionEnvioInsert[];
}

export interface ProgramacionResultado {
  /** Filas escritas: la audiencia inicial entera. */
  audienciaInicial: number;
  /** Las que nacieron en cola. */
  destinatarios: number;
}

/**
 * Borrador → programada, de una sola vez: el plan, el estado y el aviso al
 * motor (`difusion/programada` en `event_outbox`). Si algo falla no queda nada
 * escrito, así que reintentar es seguro.
 *
 * - `ConflictError` si ya no es borrador o ya tiene un plan (dos
 *   confirmaciones simultáneas: la segunda relee y la encuentra programada);
 * - `NotFoundError` si no existe;
 * - `ValidationError` si el plan viene vacío, trae filas de otra difusión o
 *   rompe una regla de la tabla (un árbol vacío sin elegir toda la base, por
 *   ejemplo);
 * - `PermissionDeniedError` si quien llama no es admin (sólo en Supabase: la
 *   función SQL lo exige).
 */
export interface DifusionProgramacionRepository {
  programar(input: ProgramacionInput): Promise<ProgramacionResultado>;
}

export function exigirPlanDeLaDifusion(input: ProgramacionInput): void {
  if (input.filas.length === 0) {
    throw new ValidationError("El plan de envío llegó vacío: no hay a quién mandarle.");
  }
  for (const f of input.filas) {
    if (f.difusion_id !== input.difusionId) {
      throw new ValidationError("Una fila del plan es de otra difusión.");
    }
  }
}

/**
 * La transacción de `programar_difusion()` emulada en memoria: valida todo lo
 * que puede fallar antes de escribir nada. Guarda en `avisos` lo que la base
 * deja en `event_outbox`, con el mismo contrato.
 */
export class InMemoryDifusionProgramacionRepository implements DifusionProgramacionRepository {
  readonly avisos: DifusionProgramada[] = [];

  constructor(
    private readonly difusiones: InMemoryDifusionesRepository,
    private readonly envios: InMemoryDifusionEnviosRepository,
  ) {}

  async programar(input: ProgramacionInput): Promise<ProgramacionResultado> {
    exigirPlanDeLaDifusion(input);

    const actual = await this.difusiones.findById(input.difusionId);
    if (!actual) {
      throw new NotFoundError(
        `no hay una difusión con id ${input.difusionId}`,
        "difusion",
        input.difusionId,
      );
    }
    if (actual.estado !== "borrador") {
      throw new ConflictError(
        `la difusión ya está ${actual.estado}: se programa una sola vez`,
        "difusion_ya_programada",
      );
    }
    if ((await this.envios.contarPorDifusion(input.difusionId)).total > 0) {
      throw new ConflictError("la difusión ya tiene un plan escrito", "difusion_ya_programada");
    }
    // La base inserta sin ON CONFLICT: un lead repetido es un 23505, no un no-op.
    const leads = new Set<string>();
    for (const f of input.filas) {
      if (leads.has(f.lead_id)) {
        throw new ConflictError("el plan trae un lead dos veces", "unique_violation");
      }
      leads.add(f.lead_id);
    }

    const problema = incoherenciaDifusion({
      ...actual,
      estado: "programada",
      programada_para: input.programadaPara,
      canary_tamano: input.canaryTamano,
    });
    if (problema) throw new ValidationError(problema);

    // `registrarPlan` valida todas las filas y escribe todo o nada.
    await this.envios.registrarPlan(input.filas);
    await this.difusiones.update(input.difusionId, {
      estado: "programada",
      programada_para: input.programadaPara,
      canary_tamano: input.canaryTamano,
    });

    const audienciaInicial = input.filas.length;
    const destinatarios = input.filas.filter((f) => f.estado !== "excluido").length;
    this.avisos.push(
      eventoDifusionProgramada({
        difusionId: input.difusionId,
        programadaPara: input.programadaPara,
        audienciaInicial,
        destinatarios,
      }).data,
    );
    return { audienciaInicial, destinatarios };
  }
}
