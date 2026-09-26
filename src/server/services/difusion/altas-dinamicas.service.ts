import { BudgetExceededError } from "@/lib/errors";
import { compilarAudiencia } from "@/lib/difusion/audiencia";
import { cupoParaPlanificar } from "@/lib/difusion/cupo";
import type { Difusion } from "@/lib/difusion/modelo";
import { planificarDifusion } from "@/lib/difusion/planificador";
import type { Logger } from "@/lib/observability/logger";
import type { DifusionAudienciaRepository } from "@/server/repositories/difusion-audiencia.repo";
import {
  filasDesdePlan,
  type DifusionEnviosRepository,
} from "@/server/repositories/difusion-envios.repo";
import { aCandidato, leerContextoPlan, type ContextoPlanDeps } from "./contexto-plan";

/**
 * La audiencia dinámica (decisión del dueño 2026-09-26): antes de cada tanda
 * se vuelve a resolver la audiencia y los leads que empezaron a coincidir se
 * suman a las tandas que siguen, hasta que la difusión termina.
 *
 * - Se resuelve con el mismo SQL que al armarla (`difusion_resolver_audiencia`).
 * - Los nuevos pasan por el mismo planificador que el plan original: bajas,
 *   dedup por teléfono y todos los motivos de exclusión, con el cupo de hoy.
 * - Un lead que ya está en la difusión no se vuelve a planificar: su fila es
 *   la que manda. Si un nuevo comparte teléfono con alguien que ya recibe, la
 *   base lo escribe excluido por duplicado (`difusion_sumar_altas()`).
 * - Las tandas de las altas se cuentan desde la que se está por mandar: la 0
 *   del planificador es esa tanda, que sale ya.
 *
 * El cupo que usa el planificador es el de ahora: el tope que devuelve Meta
 * menos lo que este CRM ya mandó en 24 h. Si hoy no entra ninguna plantilla,
 * las altas no se escriben (`sin_cupo`): siguen coincidiendo, así que entran
 * en la re-evaluación de la próxima tanda. El motor además mira el cupo en
 * cada lote antes de mandar, así que una alta nunca lo pasa.
 */

export type ResultadoAltas = {
  /** Los que coinciden hoy con la audiencia. */
  coinciden: number;
  /** De ellos, los que no estaban en la difusión. */
  nuevos: number;
  /** Filas escritas (en cola o excluidas con su motivo). */
  sumadas: number;
  /** Por qué no se sumó nadie, cuando no fue porque no había nuevos. */
  motivo?: "congelada" | "sin_cupo" | "sin_escalon";
};

export interface AltasDinamicasService {
  /**
   * Re-evalúa la audiencia de `d` antes de la tanda `tanda` y suma a los
   * nuevos. Idempotente: repetirlo no duplica a nadie.
   */
  sumar(d: Difusion, tanda: number, ahora: Date): Promise<ResultadoAltas>;
}

export interface AltasDinamicasDeps extends ContextoPlanDeps {
  audiencia: Pick<DifusionAudienciaRepository, "resolver" | "usoCupoDesde">;
  envios: Pick<DifusionEnviosRepository, "saturadosDesde" | "leadsDeLaDifusion" | "sumarAltas">;
  logger: Logger;
}

const DIA_MS = 24 * 3_600_000;

export class DefaultAltasDinamicasService implements AltasDinamicasService {
  constructor(private readonly deps: AltasDinamicasDeps) {}

  async sumar(d: Difusion, tanda: number, ahora: Date): Promise<ResultadoAltas> {
    if (d.audiencia_modo !== "dinamica") {
      return { coinciden: 0, nuevos: 0, sumadas: 0, motivo: "congelada" };
    }
    const compilada = compilarAudiencia(d.audiencia, { todaLaBase: d.audiencia_toda_la_base });
    const [candidatos, presentes] = await Promise.all([
      this.deps.audiencia.resolver(compilada, ahora),
      this.deps.envios.leadsDeLaDifusion(d.id),
    ]);
    const nuevos = candidatos.filter((c) => !presentes.has(c.leadId));
    const base = { coinciden: candidatos.length, nuevos: nuevos.length };
    if (nuevos.length === 0) return { ...base, sumadas: 0 };

    const ctx = await leerContextoPlan(this.deps, nuevos, ahora);
    if (ctx.tope.estado !== "ok") {
      this.deps.logger.warn("difusion.altas_sin_escalon", { difusionId: d.id, tanda });
      return { ...base, sumadas: 0, motivo: "sin_escalon" };
    }

    let plan;
    try {
      plan = planificarDifusion({
        ahora,
        audiencia: nuevos.map(aCandidato),
        supresiones: ctx.supresiones,
        saturaciones: ctx.saturaciones,
        maxSalientesAutomaticos24h: ctx.maxSalientes,
        plantilla: d.plantilla_categoria === null ? null : { categoria: d.plantilla_categoria },
        textoLibre: d.texto_libre !== null,
        incluirEnNegociacion: d.incluir_en_negociacion,
        exentaTopeFrecuencia: d.exenta_tope_frecuencia,
        cupo: cupoParaPlanificar({ tope: ctx.tope.tope, usado24h: ctx.usado24h }),
      });
    } catch (e) {
      if (!(e instanceof BudgetExceededError)) throw e;
      return { ...base, sumadas: 0, motivo: "sin_cupo" };
    }

    // La tanda 0 del planificador es la que se está por mandar.
    const filas = filasDesdePlan(d.id, plan).map((f) =>
      f.tanda === null
        ? f
        : {
            ...f,
            tanda: tanda + f.tanda,
            programado_para: new Date(ahora.getTime() + f.tanda * DIA_MS),
          },
    );
    const sumadas = await this.deps.envios.sumarAltas(filas);
    return { ...base, sumadas };
  }
}
