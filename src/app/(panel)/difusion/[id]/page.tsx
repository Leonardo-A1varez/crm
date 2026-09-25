import { notFound } from "next/navigation";
import { getLogger } from "@/lib/observability/get-logger";
import { getCurrentRol } from "@/server/auth/guards";
import {
  getDifusionServiceForRequest,
  leerSaludWhatsAppCacheada,
} from "@/server/bootstrap/difusion-bootstrap";
import { AsistenteDifusion } from "../_components/AsistenteDifusion";
import { PantallaEnvio } from "../_components/PantallaEnvio";
import { SoloAdmin } from "../_components/SoloAdmin";
import { leerParaPantalla } from "../_lib/leer";
import { plantillasParaDifusion, saludDelNumero, vistaEnvio } from "../_lib/vistas";
import { zonaDelNegocio } from "../_lib/zona";

export const dynamic = "force-dynamic";

/**
 * Una difusión. Si es un borrador, el asistente con lo guardado; si ya se
 * programó, su envío. Un id que no existe —o que no es un UUID— es un 404.
 */
export default async function DifusionDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const logger = getLogger({ scope: "difusion" });
  const [svc, rol, tz] = await Promise.all([
    getDifusionServiceForRequest(),
    getCurrentRol(),
    zonaDelNegocio(logger),
  ]);

  const detalle = await svc.detalle(id);
  if (detalle === null) notFound();

  if (detalle.difusion.estado === "borrador") {
    if (rol !== "admin") return <SoloAdmin titulo="Este borrador lo arma un administrador" />;

    const [salud, catalogos] = await Promise.all([
      leerSaludWhatsAppCacheada(),
      leerParaPantalla("catalogos", () => svc.catalogosAudiencia(), logger),
    ]);
    return (
      <div className="bg-surface-root flex h-full flex-col overflow-hidden">
        <AsistenteDifusion
          inicial={detalle.difusion}
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

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PantallaEnvio envio={vistaEnvio(detalle, tz)} puedeActuar={rol === "admin"} />
    </div>
  );
}
