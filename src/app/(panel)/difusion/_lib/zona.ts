import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { leerParaPantalla } from "./leer";
import type { Logger } from "@/lib/observability/logger";

/**
 * La zona horaria del negocio: `agente_config.horario_timezone`, la única del
 * sistema (`lib/zona-horaria.ts`). Las fechas de Difusión —cuándo se programó,
 * cuándo arranca cada tanda— se escriben en esa hora, nunca en la del
 * navegador.
 *
 * Si la configuración no se puede leer, UTC: el mismo criterio que Ajustes, y
 * la falla queda en el log (`difusion.lectura_fallida`, sección `agente`).
 */
export async function zonaDelNegocio(logger: Logger): Promise<string> {
  const agente = await leerParaPantalla(
    "agente",
    async () => (await getAgenteConfigServiceForRequest()).activa(),
    logger,
  );
  return agente.estado === "ok" && agente.datos !== null ? agente.datos.horario_timezone : "UTC";
}
