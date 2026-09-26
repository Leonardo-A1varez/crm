import type { CondicionWorkflowRepository } from "@/server/repositories/condicion-workflow.repo";
import type { CamposVivosDeps } from "./ejecutor.service";

/** Lo único que se lee de la config del agente: la zona del negocio. */
export interface ZonaDelNegocio {
  get(): Promise<{ horario_timezone: string }>;
}

/**
 * Lo que el ejecutor necesita para las condiciones con campos vivos: el
 * cargador (`CondicionWorkflowRepository.leerCamposVivos`) y la zona del
 * negocio (`agente_config.horario_timezone`), con la que se leen las fechas.
 * Lo arman producción (`inngest/bootstrap.ts`) y "Probar"
 * (`workflows-bootstrap.ts`), cada uno con su client.
 */
export function camposVivosDeCondicion(
  repo: Pick<CondicionWorkflowRepository, "leerCamposVivos">,
  config: ZonaDelNegocio,
): CamposVivosDeps {
  return {
    cargar: (consulta) => repo.leerCamposVivos(consulta),
    zona: async () => (await config.get()).horario_timezone,
  };
}
