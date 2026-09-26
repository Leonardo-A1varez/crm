import { ValidationError } from "@/lib/errors";
import type { Grupo } from "@/lib/ui/condiciones";
import { camposSinConteoDe, type CampoCondicion } from "@/lib/workflows/condiciones";
import { problemasDeArbol } from "@/lib/workflows/condiciones.schema";
import type {
  CatalogosCondicion,
  CondicionWorkflowRepository,
} from "@/server/repositories/condicion-workflow.repo";
import type { ZonaDelNegocio } from "./campos-vivos";

export type { CatalogosCondicion };

/**
 * Cuántos leads cumplen la condición ahora mismo, o por qué no se puede
 * contar. "Respondió" depende del disparo —es "el lead acaba de escribir"—:
 * sobre la base no hay a quién contárselo, y dar un número sería inventarlo.
 */
export type ResultadoCoincidencias =
  | { tipo: "contado"; total: number; leads: { id: string; nombre: string | null }[] }
  | { tipo: "no_contable"; campos: CampoCondicion[] };

export interface CondicionWorkflowService {
  catalogos(): Promise<CatalogosCondicion>;
  /**
   * `muestra`: cuántos leads devolver para "Ver la lista" (0 = sólo el total).
   * Una condición incompleta es `ValidationError`: el panel no muestra número
   * para una condición a medias, y el servidor tampoco lo calcula.
   */
  coincidencias(arbol: Grupo, muestra: number): Promise<ResultadoCoincidencias>;
}

export class DefaultCondicionWorkflowService implements CondicionWorkflowService {
  constructor(
    private readonly deps: {
      repo: CondicionWorkflowRepository;
      config: ZonaDelNegocio;
      ahora?: () => Date;
    },
  ) {}

  catalogos(): Promise<CatalogosCondicion> {
    return this.deps.repo.catalogos();
  }

  async coincidencias(arbol: Grupo, muestra: number): Promise<ResultadoCoincidencias> {
    const problemas = problemasDeArbol(arbol);
    if (problemas.length > 0) {
      throw new ValidationError(`La condición no está completa: ${problemas.join("; ")}.`);
    }
    const sinConteo = camposSinConteoDe(arbol);
    if (sinConteo.length > 0) return { tipo: "no_contable", campos: sinConteo };

    const zona = (await this.deps.config.get()).horario_timezone;
    const r = await this.deps.repo.coincidencias(arbol, {
      ahora: this.deps.ahora?.() ?? new Date(),
      zona,
      muestra,
    });
    return { tipo: "contado", total: r.total, leads: r.leads };
  }
}
