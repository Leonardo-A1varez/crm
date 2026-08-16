import { PageHeader } from "@/components/shared/PageHeader";
import { estaAbierto } from "@/lib/agente/horario";
import { getCurrentRol } from "@/server/auth/guards";
import {
  getAgenteConfigServiceForRequest,
  getAgentePreviewSessionsServiceForRequest,
} from "@/server/bootstrap/agente-bootstrap";
import { getReglasAdminServiceForRequest } from "@/server/bootstrap/reglas-bootstrap";
import { getTagsAdminServiceForRequest } from "@/server/bootstrap/tags-bootstrap";
import { AgenteConsola } from "./_components/AgenteConsola";
import { PanelEstadoAgente } from "./_components/PanelEstadoAgente";
import { esTabAgente } from "./_components/tabs";

export const dynamic = "force-dynamic";

export default async function AgentePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const pedida = typeof params.tab === "string" ? params.tab : undefined;
  // `reglas` primero: es la pestaña que reemplaza al ítem "Intents y reglas"
  // de la nav, así que es la que tiene que estar arriba al entrar.
  const tabInicial = esTabAgente(pedida) ? pedida : "reglas";

  const [rol, agenteSvc, previewSessionsSvc, reglasSvc, tagsSvc] = await Promise.all([
    getCurrentRol(),
    getAgenteConfigServiceForRequest(),
    getAgentePreviewSessionsServiceForRequest(),
    getReglasAdminServiceForRequest(),
    getTagsAdminServiceForRequest(),
  ]);

  const [configActiva, historial, previewSessions, intents, reglas, reglasEtiqueta, etiquetas] =
    await Promise.all([
      agenteSvc.activa(),
      agenteSvc.historial(),
      previewSessionsSvc.list(),
      reglasSvc.listarIntents(),
      reglasSvc.listarReglas(),
      reglasSvc.listarReglasEtiqueta(),
      // Solo para el selector del alta: el catálogo se administra desde Leads.
      tagsSvc.listar(),
    ]);

  // Se resuelve en el server: `estaAbierto` depende de la timezone configurada
  // y calcularlo en el cliente daría un estado distinto en el primer render.
  const abierto =
    configActiva !== null
      ? estaAbierto(configActiva.horario, configActiva.horario_timezone, new Date())
      : false;

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="OpenAI settings"
        subtitle="Reglas, escalado y límites del vendedor automático"
        actions={
          configActiva ? (
            <PanelEstadoAgente
              abierto={abierto}
              version={configActiva.version}
              modelo={configActiva.modelo}
            />
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {configActiva ? (
          <AgenteConsola
            configActiva={configActiva}
            historial={historial}
            sesiones={previewSessions.sesiones}
            previewDisponible={previewSessions.disponible}
            esAdmin={rol === "admin"}
            intents={intents}
            reglas={reglas}
            reglasEtiqueta={reglasEtiqueta}
            etiquetas={etiquetas.map((t) => ({ id: t.id, nombre: t.nombre }))}
            tabInicial={tabInicial}
          />
        ) : (
          // Defensivo: la migración inicial siembra una fila activa (Task 5),
          // así que esto no debería ocurrir en producción. Si pasa, mejor un
          // mensaje claro que una página en blanco o un crash de tipos.
          <p className="text-ink-faint text-[12.5px]">
            No hay una configuración activa del agente. Contactá a soporte.
          </p>
        )}
      </div>
    </div>
  );
}
