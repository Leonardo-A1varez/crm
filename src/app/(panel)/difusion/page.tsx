import { getLogger } from "@/lib/observability/get-logger";
import { getCurrentRol } from "@/server/auth/guards";
import { getRegistrosWhatsAppServiceForRequest } from "@/server/bootstrap/ajustes-bootstrap";
import {
  getDifusionServiceForRequest,
  leerSaludWhatsAppCacheada,
} from "@/server/bootstrap/difusion-bootstrap";
import { PantallaListado } from "./_components/PantallaListado";
import { leerParaPantalla } from "./_lib/leer";
import { filasDelListado, saludDelNumero } from "./_lib/vistas";
import { zonaDelNegocio } from "./_lib/zona";
import type { Cupo, Dato, ListadoVista } from "@/components/difusion";

export const dynamic = "force-dynamic";

/**
 * Listado de difusiones. De dónde sale cada cosa:
 *
 *   - las difusiones con sus métricas, las bajas y los destinatarios de 30
 *     días → `DifusionService.listar()`;
 *   - el cupo de 24 h → `estadoCupo()`: el escalón que devuelve Meta y el uso
 *     contado con los envíos de este CRM, porque Meta no lo expone;
 *   - calidad, estado de envío y plantillas pausadas → la misma lectura de
 *     Meta que usa Ajustes;
 *   - el aviso de sanción → los `account_update` guardados, contrastados con
 *     el `health_status` de Meta por la misma traducción que Ajustes.
 *
 * Cada lectura falla por su lado y la tarjeta dice el motivo en su lugar.
 */
export default async function DifusionPage() {
  const logger = getLogger({ scope: "difusion" });
  const [svc, rol, tz, salud] = await Promise.all([
    getDifusionServiceForRequest(),
    getCurrentRol(),
    zonaDelNegocio(logger),
    leerSaludWhatsAppCacheada(),
  ]);
  const [listado, cupo, sanciones] = await Promise.all([
    leerParaPantalla("listado", () => svc.listar(), logger),
    leerParaPantalla("cupo", () => svc.estadoCupo(), logger),
    leerParaPantalla(
      "sanciones",
      async () => (await getRegistrosWhatsAppServiceForRequest()).sanciones(),
      logger,
    ),
  ]);

  const vistaListado: Dato<ListadoVista> =
    listado.estado === "ok"
      ? {
          estado: "ok",
          valor: {
            difusiones: filasDelListado(listado.datos.difusiones, tz),
            hayMas: listado.datos.hayMas,
            suprimidos: listado.datos.suprimidos,
            destinatarios30d: listado.datos.destinatarios30d,
            destinatarios30dCompleto: listado.datos.destinatarios30dCompleto,
          },
        }
      : { estado: "sin-dato", motivo: listado.mensaje };

  const vistaCupo: Cupo =
    cupo.estado === "ok"
      ? cupo.datos
      : {
          estado: "sin-dato",
          motivo: `No se pudo calcular el cupo: ${cupo.mensaje}`,
          solicitado: 0,
        };

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PantallaListado
        listado={vistaListado}
        cupo={vistaCupo}
        salud={saludDelNumero(salud, tz, sanciones)}
        puedeCrear={rol === "admin"}
      />
    </div>
  );
}
