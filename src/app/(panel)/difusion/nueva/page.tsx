import { getLogger } from "@/lib/observability/get-logger";
import { getCurrentRol } from "@/server/auth/guards";
import {
  getDifusionServiceForRequest,
  leerSaludWhatsAppCacheada,
} from "@/server/bootstrap/difusion-bootstrap";
import { AsistenteDifusion } from "../_components/AsistenteDifusion";
import { SoloAdmin } from "../_components/SoloAdmin";
import { leerParaPantalla } from "../_lib/leer";
import { plantillasParaDifusion, saludDelNumero } from "../_lib/vistas";
import { zonaDelNegocio } from "../_lib/zona";

export const dynamic = "force-dynamic";

/**
 * Asistente de difusión nueva: Audiencia → Mensaje → Pre-vuelo.
 *
 * Nada se guarda hasta el primer "Continuar", que crea el borrador. Los
 * catálogos (etiquetas, vendedores, campañas) salen de la base; las plantillas
 * y la salud del número, de Meta. El alcance se pide al servidor mientras se
 * arma (`calcularAlcanceAction`).
 */
export default async function NuevaDifusionPage() {
  const rol = await getCurrentRol();
  if (rol !== "admin") return <SoloAdmin titulo="Solo un administrador arma difusiones" />;

  const logger = getLogger({ scope: "difusion" });
  const [svc, tz, salud] = await Promise.all([
    getDifusionServiceForRequest(),
    zonaDelNegocio(logger),
    leerSaludWhatsAppCacheada(),
  ]);
  const catalogos = await leerParaPantalla("catalogos", () => svc.catalogosAudiencia(), logger);

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <AsistenteDifusion
        inicial={null}
        catalogos={catalogos.estado === "ok" ? catalogos.datos : {}}
        avisoCatalogos={
          catalogos.estado === "ok"
            ? null
            : `No se pudieron leer las etiquetas, los vendedores y las campañas: ${catalogos.mensaje}. Esos campos quedan sin opciones.`
        }
        plantillas={plantillasParaDifusion(salud)}
        salud={saludDelNumero(salud, tz)}
        zonaHoraria={tz}
      />
    </div>
  );
}
